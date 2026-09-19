import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { z } from 'zod';
import {
  PublishingMetadataSchema,
  PublishingResultSchema,
  type Publisher,
  type PublishingMetadata,
  type PublishingResult,
} from '../../models.js';
import { checkFinalRenderReadiness, WorkspaceSchema, type Diagnostic } from '../../validation.js';
import type { ContentPlan } from '../content-plans/models.js';
import type { SourceFrame } from '../source-frames/models.js';
import type { ThumbnailProject } from '../thumbnails/models.js';

/** Evidence from a completed final render and full media decode, supplied by the caller. */
export const FinalRenderEvidenceSchema = z.strictObject({
  kind: z.literal('final'),
  projectId: z.string().min(1),
  videoFile: z.string().min(1),
  productionRevision: z.number().int().nonnegative(),
  overridesRevision: z.number().int().nonnegative(),
  byteLength: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fullDecodePassed: z.literal(true),
  verifiedAt: z.iso.datetime({ offset: true }),
});

export const PublishingRequestSchema = z.strictObject({
  metadata: PublishingMetadataSchema,
  render: FinalRenderEvidenceSchema,
});
export type PublishingRequest = z.infer<typeof PublishingRequestSchema>;

export interface PublishingDependencies {
  projectRoot: string;
  getWorkspace(): unknown;
  contentPlans: Pick<{ getContentPlan(id: string): ContentPlan }, 'getContentPlan'>;
  sourceFrames: Pick<{ getFrame(id: string): SourceFrame }, 'getFrame'>;
  thumbnails: Pick<{ listProjects(): ThumbnailProject[] }, 'listProjects'>;
  /** Optional on purpose: production has no upload adapter or OAuth wiring. */
  publisher?: Publisher;
}

export interface PublishingReview {
  status: 'ready' | 'blocked';
  diagnostics: Diagnostic[];
  metadata?: PublishingMetadata;
}

export interface PublishingAttempt {
  status: 'uploaded' | 'blocked' | 'failed';
  diagnostics: Diagnostic[];
  result?: PublishingResult;
}

function diagnostic(code: string, path: string, message: string): Diagnostic {
  return { severity: 'error', code, path, message };
}

function confinedPath(root: string, input: string): string | null {
  if (!input || input.includes('\0') || isAbsolute(input) || win32.isAbsolute(input)
    || /^[A-Za-z]:/.test(input) || input.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.includes(':'))) return null;
  const target = resolve(root, ...input.split(/[\\/]/));
  const inside = relative(root, target);
  return inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) ? target : null;
}

async function verifyFile(root: string, path: string, byteLength: number, sha256: string): Promise<'ok' | 'missing' | 'outside' | 'mismatch'> {
  const target = confinedPath(root, path);
  if (!target) return 'outside';
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    const inside = relative(realRoot, realTarget);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return 'outside';
    const before = await stat(realTarget);
    if (!before.isFile() || before.size !== byteLength) return 'mismatch';
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(realTarget)) hash.update(chunk as Buffer);
    const after = await stat(realTarget);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || hash.digest('hex') !== sha256) return 'mismatch';
    return 'ok';
  } catch {
    return 'missing';
  }
}

function metadataDiagnostics(metadata: PublishingMetadata): Diagnostic[] {
  const errors: Diagnostic[] = [];
  if (metadata.title.trim() !== metadata.title || metadata.title.length > 100) errors.push(diagnostic('TITLE_INVALID', 'metadata.title', 'Title must be trimmed and at most 100 characters.'));
  if (metadata.description.length > 5000) errors.push(diagnostic('DESCRIPTION_INVALID', 'metadata.description', 'Description must be at most 5000 characters.'));
  if (metadata.tags.length > 500 || metadata.tags.some(tag => tag.trim() !== tag || tag.length > 100)) errors.push(diagnostic('TAGS_INVALID', 'metadata.tags', 'Tags must be trimmed and within limits.'));
  if (metadata.hashtags.some(tag => tag.trim() !== tag || !/^#[^\s#]+$/u.test(tag))) errors.push(diagnostic('HASHTAGS_INVALID', 'metadata.hashtags', 'Hashtags must begin with # and contain no spaces.'));
  if (!metadata.videoFile.toLowerCase().endsWith('.mp4')) errors.push(diagnostic('VIDEO_FORMAT_UNSUPPORTED', 'metadata.videoFile', 'Final video must be an MP4 file.'));
  if (metadata.scheduledPublishAt) errors.push(diagnostic('SCHEDULING_UNSUPPORTED', 'metadata.scheduledPublishAt', 'Scheduling is not available in this boundary.'));
  return errors;
}

function failed(metadata: PublishingMetadata, code: string, retryable: boolean): Extract<PublishingResult, { status: 'failed' }> {
  return {
    status: 'failed', contentId: metadata.contentId, projectId: metadata.projectId,
    error: { code, message: 'Publishing did not complete.', retryable },
  };
}

export class YouTubePublishingBoundary {
  readonly #dependencies: PublishingDependencies;

  constructor(dependencies: PublishingDependencies) {
    this.#dependencies = dependencies;
  }

  /** Local dry run. No publisher call and no persistent state change. */
  async review(input: unknown): Promise<PublishingReview> {
    const parsed = PublishingRequestSchema.safeParse(input);
    if (!parsed.success) return {
      status: 'blocked', diagnostics: parsed.error.issues.map(issue => diagnostic('INVALID_INPUT', issue.path.join('.'), issue.message)),
    };
    const { metadata, render } = parsed.data;
    const errors = metadataDiagnostics(metadata);
    let workspace: unknown;
    try { workspace = this.#dependencies.getWorkspace(); }
    catch { errors.push(diagnostic('WORKSPACE_UNAVAILABLE', 'workspace', 'Workspace could not be read.')); }
    const workspaceParsed = WorkspaceSchema.safeParse(workspace);
    if (!workspaceParsed.success) {
      errors.push(diagnostic('WORKSPACE_INVALID', 'workspace', 'Workspace contract is invalid.'));
    } else {
      errors.push(...checkFinalRenderReadiness(workspaceParsed.data, metadata.projectId).diagnostics);
      const project = workspaceParsed.data.projects.find(item => item.production.project.id === metadata.projectId);
      const content = workspaceParsed.data.contents.find(item => item.id === metadata.contentId);
      if (!content || content.productionProjectId !== metadata.projectId) errors.push(diagnostic('CONTENT_PROJECT_MISMATCH', 'metadata.contentId', 'Content is not linked to the production project.'));
      if (project && (render.projectId !== metadata.projectId || render.productionRevision !== project.production.project.revision
        || render.overridesRevision !== project.overrides.revision || render.videoFile !== metadata.videoFile)) {
        errors.push(diagnostic('RENDER_EVIDENCE_MISMATCH', 'render', 'Final render evidence does not match the current project and video.'));
      }
    }

    let plan: ContentPlan | undefined;
    try { plan = this.#dependencies.contentPlans.getContentPlan(metadata.contentId); }
    catch { errors.push(diagnostic('CONTENT_PLAN_UNAVAILABLE', 'metadata.contentId', 'Content plan could not be read.')); }
    if (plan && (plan.contentId !== metadata.contentId || plan.status !== 'READY')) {
      errors.push(diagnostic('CONTENT_PLAN_NOT_READY', 'metadata.contentId', 'Content plan must be READY before publishing.'));
    }
    if (plan?.sourceFrameId) {
      try {
        const frame = this.#dependencies.sourceFrames.getFrame(plan.sourceFrameId);
        if (frame.id !== plan.sourceFrameId || (plan.sourceClipId && frame.sourceClipId !== plan.sourceClipId)) {
          errors.push(diagnostic('SOURCE_FRAME_MISMATCH', 'contentPlan.sourceFrameId', 'Source frame does not match the content plan.'));
        }
        if (frame.rightsReviewStatus !== 'reviewed') errors.push(diagnostic('SOURCE_FRAME_REVIEW_REQUIRED', 'contentPlan.sourceFrameId', 'Source frame must have current rights approval.'));
      } catch { errors.push(diagnostic('SOURCE_FRAME_UNAVAILABLE', 'contentPlan.sourceFrameId', 'Source frame could not be read.')); }
    }

    let thumbnail: { path: string; byteLength: number; sha256: string } | undefined;
    if (metadata.thumbnail) {
      try {
        const linked = this.#dependencies.thumbnails.listProjects().filter(item => item.contentId === metadata.contentId);
        const matching = linked.flatMap(project => project.exports.map(entry => ({ project, entry })))
          .find(({ entry }) => entry.path === metadata.thumbnail);
        if (!matching) errors.push(diagnostic('THUMBNAIL_EXPORT_REQUIRED', 'metadata.thumbnail', 'Thumbnail must be a linked project export.'));
        else {
          const { project, entry } = matching;
          if (project.revision !== entry.productionRevision + 1) errors.push(diagnostic('THUMBNAIL_EXPORT_STALE', 'metadata.thumbnail', 'Thumbnail project changed after export.'));
          if (project.baseImage?.sourceFrame) {
            const reference = project.baseImage.sourceFrame;
            if (!reference.sourceFrameId) errors.push(diagnostic('THUMBNAIL_SOURCE_FRAME_REQUIRED', 'metadata.thumbnail', 'Thumbnail source frame needs an ID.'));
            else {
              try {
                const frame = this.#dependencies.sourceFrames.getFrame(reference.sourceFrameId);
                if (frame.id !== reference.sourceFrameId || frame.sourceClipId !== reference.sourceClipId
                  || frame.sha256 !== project.baseImage.sha256 || (plan?.sourceClipId && frame.sourceClipId !== plan.sourceClipId)) {
                  errors.push(diagnostic('THUMBNAIL_SOURCE_MISMATCH', 'metadata.thumbnail', 'Thumbnail source differs from the reviewed frame.'));
                }
                if (frame.rightsReviewStatus !== 'reviewed') errors.push(diagnostic('THUMBNAIL_RIGHTS_REVIEW_REQUIRED', 'metadata.thumbnail', 'Thumbnail source frame must have current rights approval.'));
              } catch { errors.push(diagnostic('THUMBNAIL_SOURCE_UNAVAILABLE', 'metadata.thumbnail', 'Thumbnail source frame could not be read.')); }
            }
          }
          thumbnail = entry;
        }
      } catch { errors.push(diagnostic('THUMBNAIL_LOOKUP_FAILED', 'metadata.thumbnail', 'Thumbnail project could not be read.')); }
    }

    const videoStatus = await verifyFile(this.#dependencies.projectRoot, metadata.videoFile, render.byteLength, render.sha256);
    if (videoStatus !== 'ok') errors.push(diagnostic(`VIDEO_FILE_${videoStatus.toUpperCase()}`, 'metadata.videoFile', 'Final video file failed local verification.'));
    if (thumbnail) {
      const thumbnailStatus = await verifyFile(this.#dependencies.projectRoot, thumbnail.path, thumbnail.byteLength, thumbnail.sha256);
      if (thumbnailStatus !== 'ok') errors.push(diagnostic(`THUMBNAIL_FILE_${thumbnailStatus.toUpperCase()}`, 'metadata.thumbnail', 'Thumbnail export failed local verification.'));
    }
    return errors.some(item => item.severity === 'error')
      ? { status: 'blocked', diagnostics: errors }
      : { status: 'ready', diagnostics: errors, metadata };
  }

  /** Only an explicitly injected Publisher can be called after a fresh review. */
  async publish(input: unknown): Promise<PublishingAttempt> {
    const review = await this.review(input);
    if (review.status === 'blocked' || !review.metadata) return { status: 'blocked', diagnostics: review.diagnostics };
    const metadata = review.metadata;
    if (!this.#dependencies.publisher) return { status: 'blocked', diagnostics: [diagnostic('PUBLISHER_UNAVAILABLE', 'publisher', 'No publishing adapter is configured.')] };
    try {
      const raw = await this.#dependencies.publisher.publish(metadata);
      const result = PublishingResultSchema.safeParse(raw);
      if (!result.success || result.data.contentId !== metadata.contentId || result.data.projectId !== metadata.projectId) {
        const mapped = failed(metadata, 'PUBLISHER_INVALID_RESULT', false);
        return { status: 'failed', diagnostics: [diagnostic('PUBLISHER_INVALID_RESULT', 'publisher', mapped.error.message)], result: mapped };
      }
      if (result.data.status === 'failed') {
        const mapped = failed(metadata, 'PUBLISHER_FAILED', result.data.error.retryable);
        return { status: 'failed', diagnostics: [diagnostic('PUBLISHER_FAILED', 'publisher', mapped.error.message)], result: mapped };
      }
      return { status: 'uploaded', diagnostics: [], result: result.data };
    } catch {
      const mapped = failed(metadata, 'PUBLISHER_EXCEPTION', false);
      return { status: 'failed', diagnostics: [diagnostic('PUBLISHER_EXCEPTION', 'publisher', mapped.error.message)], result: mapped };
    }
  }
}
