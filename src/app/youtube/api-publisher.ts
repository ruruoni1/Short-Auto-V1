import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import type { Publisher, PublishingMetadata, PublishingResult } from '../../models.js';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart';

export interface YouTubeApiPublisherDependencies {
  projectRoot: string;
  getAccessToken(): string | null | undefined | Promise<string | null | undefined>;
  fetch: typeof fetch;
}

function failed(metadata: PublishingMetadata, code: string, message: string, retryable: boolean): PublishingResult {
  return {
    status: 'failed',
    contentId: metadata.contentId,
    projectId: metadata.projectId,
    error: { code, message, retryable },
  };
}

function confinedPath(root: string, input: string): string | null {
  if (!input || input.includes('\0') || isAbsolute(input) || win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)
    || input.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.includes(':'))) return null;
  const target = resolve(root, ...input.split(/[\\/]/));
  const inside = relative(root, target);
  return inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) ? target : null;
}

async function videoBytes(root: string, input: string): Promise<{ kind: 'outside' } | { kind: 'unavailable' } | { kind: 'ok'; bytes: Buffer }> {
  const target = confinedPath(root, input);
  if (!target) return { kind: 'outside' };
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    const inside = relative(realRoot, realTarget);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return { kind: 'outside' };
    if (!(await stat(realTarget)).isFile()) return { kind: 'unavailable' };
    return { kind: 'ok', bytes: await readFile(realTarget) };
  } catch {
    return { kind: 'unavailable' };
  }
}

function uploadBody(metadata: PublishingMetadata, bytes: Buffer): { body: Blob; contentType: string } {
  const boundary = `short-auto-${randomBytes(16).toString('hex')}`;
  const resource = JSON.stringify({
    snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags },
    status: { privacyStatus: metadata.visibility },
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${resource}\r\n`,
    `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    new Uint8Array(bytes),
    `\r\n--${boundary}--\r\n`,
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/** OAuth-neutral adapter. The caller owns token acquisition and upload authorization. */
export class YouTubeApiPublisher implements Publisher {
  readonly #dependencies: YouTubeApiPublisherDependencies;

  constructor(dependencies: YouTubeApiPublisherDependencies) {
    this.#dependencies = dependencies;
  }

  async publish(metadata: PublishingMetadata): Promise<PublishingResult> {
    let token: string | null | undefined;
    try {
      token = await this.#dependencies.getAccessToken();
    } catch {
      return failed(metadata, 'ACCESS_TOKEN_UNAVAILABLE', 'YouTube access token is unavailable.', true);
    }
    if (typeof token !== 'string' || !token.trim()) {
      return failed(metadata, 'ACCESS_TOKEN_MISSING', 'YouTube access token is required.', false);
    }
    const accessToken = token.trim();

    if (metadata.scheduledPublishAt) {
      return failed(metadata, 'SCHEDULING_UNSUPPORTED', 'Scheduled publishing is unsupported.', false);
    }
    if (!metadata.videoFile.toLowerCase().endsWith('.mp4')) {
      return failed(metadata, 'VIDEO_FORMAT_UNSUPPORTED', 'Video file must be an MP4.', false);
    }

    const video = await videoBytes(this.#dependencies.projectRoot, metadata.videoFile);
    if (video.kind === 'outside') return failed(metadata, 'VIDEO_FILE_OUTSIDE', 'Video file must be inside the project.', false);
    if (video.kind === 'unavailable') return failed(metadata, 'VIDEO_FILE_UNAVAILABLE', 'Video file could not be read.', false);

    const { body, contentType } = uploadBody(metadata, video.bytes);
    let response: Response;
    try {
      response = await this.#dependencies.fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType },
        body,
      });
    } catch {
      return failed(metadata, 'UPLOAD_NETWORK_ERROR', 'YouTube upload request failed.', true);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      return failed(metadata, 'UPLOAD_HTTP_ERROR', 'YouTube upload was rejected.', retryable);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failed(metadata, 'UPLOAD_INVALID_RESPONSE', 'YouTube upload response was invalid.', false);
    }
    if (!payload || typeof payload !== 'object' || !('id' in payload)
      || typeof payload.id !== 'string' || !payload.id.trim()) {
      return failed(metadata, 'UPLOAD_INVALID_RESPONSE', 'YouTube upload response was invalid.', false);
    }
    return {
      status: 'uploaded', contentId: metadata.contentId, projectId: metadata.projectId,
      videoId: payload.id, uploadedAt: new Date().toISOString(),
    };
  }
}
