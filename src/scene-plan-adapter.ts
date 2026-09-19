import { z } from 'zod';
import { SceneSchema } from './models.js';
import { validateCaptions } from './caption.js';
import { TimelineInputSchema, resolveTimeline } from './timeline.js';
import type { TimelineInput } from './timeline.js';
import type { Diagnostic } from './validation.js';

const DiagnosticSchema = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1),
  path: z.string(),
  message: z.string().min(1),
});

/** The exact JSON copied by the Review Editor after a successful planning pass. */
export const ReviewedScenePlanSchema = z.strictObject({
  version: z.literal(1),
  reviewedAt: z.iso.datetime({ offset: true }),
  scenes: z.array(SceneSchema),
  diagnostics: z.array(DiagnosticSchema),
});
export type ReviewedScenePlan = z.infer<typeof ReviewedScenePlanSchema>;

export type ApplyReviewedScenePlanResult =
  | { valid: true; input: TimelineInput; diagnostics: Diagnostic[] }
  | { valid: false; input: null; diagnostics: Diagnostic[] };

const error = (code: string, path: string, message: string): Diagnostic => ({ severity: 'error', code, path, message });
const failure = (diagnostics: Diagnostic[]): ApplyReviewedScenePlanResult => ({ valid: false, input: null, diagnostics });
const prefix = (path: string, root: string) => path ? `${root}.${path}` : root;

/**
 * Applies reviewed presentation data only. It does not approve a project or
 * change its revision, status, source, assets, overrides, or output timing.
 */
export function applyReviewedScenePlan(input: unknown, handoff: unknown): ApplyReviewedScenePlanResult {
  const reviewed = ReviewedScenePlanSchema.safeParse(handoff);
  if (!reviewed.success) return failure(reviewed.error.issues.map(issue =>
    error('SCENE_PLAN_HANDOFF_SCHEMA', issue.path.join('.'), issue.message)));

  const parsed = TimelineInputSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues.map(issue =>
    error('SCENE_PLAN_INPUT_SCHEMA', issue.path.join('.'), issue.message)));

  const diagnostics: Diagnostic[] = [...reviewed.data.diagnostics];
  if (diagnostics.some(item => item.severity === 'error')) {
    diagnostics.push(error('SCENE_PLAN_REVIEW_ERRORS', 'diagnostics', 'Reviewed plan contains errors'));
  }
  if (reviewed.data.scenes.length === 0) {
    diagnostics.push(error('SCENE_PLAN_EMPTY', 'scenes', 'Reviewed plan needs at least one Scene'));
  }

  const sourceValidation = validateCaptions(parsed.data.source);
  diagnostics.push(...sourceValidation.diagnostics.map(item => ({ ...item, path: prefix(item.path, 'source') })));
  const original = resolveTimeline(parsed.data);
  if (!original.valid) diagnostics.push(...original.diagnostics.map(item => ({ ...item, path: prefix(item.path, 'input') })));
  if (diagnostics.some(item => item.severity === 'error')) return failure(diagnostics);

  const captionIds = new Set(parsed.data.source.captions.map(caption => caption.id));
  const covered = new Set<number>();
  const sceneIds = new Set<string>();
  reviewed.data.scenes.forEach((scene, index) => {
    const root = `scenes.${index}`;
    if (sceneIds.has(scene.id)) diagnostics.push(error('SCENE_PLAN_DUPLICATE_ID', `${root}.id`, `Duplicate Scene ID ${scene.id}`));
    sceneIds.add(scene.id);
    const { start, end } = scene.captionRange;
    if (!captionIds.has(start) || !captionIds.has(end)) {
      diagnostics.push(error('SCENE_PLAN_CAPTION_REF', `${root}.captionRange`, 'Scene range endpoints must reference Source Caption IDs'));
      return;
    }
    for (const caption of parsed.data.source.captions) {
      if (start <= caption.id && caption.id <= end) {
        if (covered.has(caption.id)) diagnostics.push(error('SCENE_PLAN_OVERLAP', `${root}.captionRange`, `Caption ${caption.id} belongs to multiple reviewed Scenes`));
        covered.add(caption.id);
      }
    }
  });
  if (diagnostics.some(item => item.severity === 'error')) return failure(diagnostics);

  // Zod parsing has detached the input and handoff from their callers.
  const candidate: TimelineInput = {
    ...parsed.data,
    production: { ...parsed.data.production, scenes: reviewed.data.scenes },
  };
  const resolved = resolveTimeline(candidate);
  if (!resolved.valid) return failure([...diagnostics, ...resolved.diagnostics.map(item => ({ ...item, path: prefix(item.path, 'candidate') }))]);
  return { valid: true, input: candidate, diagnostics: [...diagnostics, ...resolved.diagnostics] };
}
