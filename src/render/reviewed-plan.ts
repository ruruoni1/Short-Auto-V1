import { applyReviewedScenePlan } from '../scene-plan-adapter.js';
import type { CaptionDisplayPolicy, ChannelPack } from '../index.js';
import { prepareScenePreview, SceneRenderError } from './plan.js';
import type { ScenePreviewPlan } from './plan.js';

/** Validates a reviewed Scene handoff before building the existing draft Preview plan. */
export function prepareReviewedScenePreview(
  input: unknown,
  handoff: unknown,
  pack: ChannelPack,
  captionDisplayPolicy?: CaptionDisplayPolicy,
): ScenePreviewPlan {
  const adapted = applyReviewedScenePlan(input, handoff);
  if (!adapted.valid) throw new SceneRenderError(adapted.diagnostics);
  return prepareScenePreview(adapted.input, pack, captionDisplayPolicy);
}
