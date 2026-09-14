import { TimelineInputSchema, buildCaptionDisplay, resolveTimeline, createThemedSceneRuntime, resolveAssets, resolveTheme, samplePlannedSceneMotion, selectTransition, sampleTransition } from '../index.js';
import type { Diagnostic, TimelineInput, ChannelPack, SceneRuntime, SceneRuntimeState, ResolvedTimeline, AssetResolutionPlan, ThemeSelection, PlannedScene, CaptionDisplayPolicy, CaptionDisplayUnit } from '../index.js';

export class SceneRenderError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) { super(diagnostics.map(d => `${d.code}: ${d.message}`).join('\n')); this.name = 'SceneRenderError'; }
}
export function frameToMs(frame: number, fps: number): number {
  if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isFinite(fps) || fps <= 0 || fps > 240) throw new RangeError('Invalid frame/fps');
  const ms = Math.floor(frame * 1000 / fps);
  if (!Number.isSafeInteger(ms)) throw new RangeError('Frame time overflow');
  return ms;
}
export function msToFrame(ms: number, fps: number): number {
  if (!Number.isSafeInteger(ms) || ms < 0 || !Number.isFinite(fps) || fps <= 0 || fps > 240) throw new RangeError('Invalid ms/fps');
  const frame = Math.ceil(ms * fps / 1000);
  if (!Number.isSafeInteger(frame)) throw new RangeError('Frame boundary overflow');
  return frame;
}
export function frameInterval(start: number, end: number, fps: number) {
  if (end < start) throw new RangeError('Reversed interval');
  const from = msToFrame(start, fps), to = msToFrame(end, fps);
  return { from, durationInFrames: to - from };
}
export interface ScenePreviewPlan {
  input: TimelineInput; runtime: SceneRuntime; timeline: ResolvedTimeline;
  assets: AssetResolutionPlan; theme: ThemeSelection; diagnostics: Diagnostic[];
  /** Null preserves the legacy cue-level display path. */
  captionDisplayUnits: CaptionDisplayUnit[] | null;
}
export type ActiveCaptionDisplay =
  | { origin: 'source'; unit: CaptionDisplayUnit; lines: string[] }
  | { origin: 'override'; sceneId: string; lines: string[] };
const fail = (code: string, path: string, message: string): never => { throw new SceneRenderError([{ severity: 'error', code, path, message }]); };
/** Preview only: does not approve or expose a production final-render API. */
export function prepareScenePreview(input: unknown, pack: ChannelPack, captionDisplayPolicy?: CaptionDisplayPolicy): ScenePreviewPlan {
  const timeline = resolveTimeline(input);
  if (!timeline.valid) throw new SceneRenderError(timeline.diagnostics);
  const data = TimelineInputSchema.parse(input);
  const p = data.production;
  if (p.settings.width * 9 !== p.settings.height * 16 && p.settings.width * 16 !== p.settings.height * 9) fail('RENDER_ASPECT_RATIO', 'settings', 'Preview supports 16:9 or 9:16');
  const themed = createThemedSceneRuntime(data, timeline.timeline, pack);
  if (!themed.valid) throw new SceneRenderError(themed.diagnostics);
  const selected = resolveTheme(pack, { packId: p.project.channelPack, themeId: p.settings.theme, profileId: p.project.contentProfile });
  if (!selected.valid) throw new SceneRenderError(selected.diagnostics);
  // These built-in types have an actual SVG/list implementation in SceneVisual.
  const graphicIds = themed.runtime.scenes.filter(s => ['COMPARE', 'RELATION', 'CONCEPT'].includes(s.scene.type)).map(s => s.scene.id);
  const assets = resolveAssets({ production: p, overrides: data.overrides }, { generatedGraphicSceneIds: graphicIds });
  if (!assets.valid) throw new SceneRenderError(assets.diagnostics);
  for (const [index, scene] of themed.runtime.scenes.entries()) {
    const motion = samplePlannedSceneMotion(scene, scene.sourceStartMs, { index: 0, count: 1 });
    if (!motion.supported) throw new SceneRenderError(motion.diagnostics);
    const transition = sampleTransition(selectTransition(scene.scene.transition, selected.selection.theme), 0);
    if (!transition.supported) throw new SceneRenderError(transition.diagnostics);
    if (themed.runtime.scenes.slice(0, index).some(s => s.sourceStartMs < scene.sourceEndMs && scene.sourceStartMs < s.sourceEndMs)) fail('RENDER_SCENE_OVERLAP_UNSUPPORTED', scene.scene.id, 'Minimal Preview does not lay out simultaneous Scenes');
    const choice = assets.plan.scenes.find(s => s.id === scene.scene.id)!;
    if (choice.preview === 'asset' && ['video', 'anime_clip', 'drama_clip'].includes(choice.selectedAsset!.type)) fail('RENDER_SCENE_VIDEO_UNSUPPORTED', scene.scene.id, 'Video is supported in Inserts/Overlays; Source Scene video seeking is a later unit');
  }
  let captionDisplayUnits: CaptionDisplayUnit[] | null = null;
  const captionDiagnostics: Diagnostic[] = [];
  if (captionDisplayPolicy !== undefined) {
    const sourceCaptionIndexes = data.source.captions.flatMap((caption, index) => themed.runtime.scenes.some(scene =>
      scene.scene.captionRange.start <= caption.id && caption.id <= scene.scene.captionRange.end && Object.hasOwn(scene.caption, 'lines')) ? [] : [index]);
    const sourceCaptions = sourceCaptionIndexes.map(index => data.source.captions[index]!);
    const display = buildCaptionDisplay({ durationMs: data.source.durationMs, captions: sourceCaptions }, captionDisplayPolicy);
    const displayDiagnostics = display.diagnostics.flatMap(diagnostic => {
      if (sourceCaptions.length === 0 && diagnostic.code === 'CAPTION_EMPTY') return [];
      const match = /^captions\.(\d+)(.*)$/.exec(diagnostic.path);
      if (!match) return [diagnostic];
      const originalIndex = sourceCaptionIndexes[Number(match[1])];
      return [{ ...diagnostic, path: originalIndex === undefined ? diagnostic.path : `captions.${originalIndex}${match[2]}` }];
    });
    if (!display.valid) throw new SceneRenderError(displayDiagnostics);
    captionDisplayUnits = display.units.map(unit => ({
      ...unit,
      sourceCaptionIndex: sourceCaptionIndexes[unit.sourceCaptionIndex]!,
    }));
    captionDiagnostics.push(...displayDiagnostics);
    for (const [index, unit] of captionDisplayUnits.entries()) {
      const represented = timeline.timeline.segments.some(segment => {
        if (segment.type !== 'tts') return false;
        const sourceStartMs = Math.max(unit.startMs, segment.sourceStartMs);
        const sourceEndMs = Math.min(unit.endMs, segment.sourceEndMs);
        if (sourceStartMs >= sourceEndMs) return false;
        const outputStartMs = segment.outputStartMs + sourceStartMs - segment.sourceStartMs;
        const outputEndMs = segment.outputStartMs + sourceEndMs - segment.sourceStartMs;
        return msToFrame(outputEndMs, p.settings.fps) > msToFrame(outputStartMs, p.settings.fps);
      });
      if (!represented) captionDiagnostics.push({
        severity: 'error', code: 'RENDER_CAPTION_UNIT_UNCAPTURED', path: `captionDisplay.units.${index}`,
        message: `Caption ${unit.sourceCaptionId} display unit ${unit.unitIndex} has no output frame at ${p.settings.fps}fps`,
      });
    }
    if (captionDiagnostics.some(d => d.severity === 'error')) throw new SceneRenderError(captionDiagnostics);
  }
  return { input: data, runtime: themed.runtime, timeline: timeline.timeline, assets: assets.plan, theme: selected.selection,
    captionDisplayUnits, diagnostics: [...themed.diagnostics, ...assets.diagnostics, ...captionDiagnostics] };
}

/** Chooses presentation data using Runtime Source time. Override lines never claim source offsets. */
export function selectCaptionDisplay(state: SceneRuntimeState, units: readonly CaptionDisplayUnit[]): ActiveCaptionDisplay | null {
  if (state.sourceTimeMs === null || state.caption === null) return null;
  const current = state.scenes[0];
  if (current) {
    if (!current.captionVisible) return null;
    if (Object.hasOwn(current.caption, 'lines')) return {
      origin: 'override', sceneId: current.scene.id, lines: [...current.caption.lines!],
    };
  } else if (!state.unassignedCaptionVisible) return null;
  const unit = units.find(candidate => candidate.sourceCaptionId === state.caption!.id &&
    candidate.startMs <= state.sourceTimeMs! && state.sourceTimeMs! < candidate.endMs);
  return unit ? { origin: 'source', unit, lines: unit.lines.map(line => line.text) } : null;
}
/** Adjacent Source scenes only; a stop at the boundary suppresses outgoing hold. */
export function previousTransitionScene(plan: ScenePreviewPlan, current: PlannedScene): PlannedScene | null {
  const previous = plan.runtime.scenes.find(s => s.sourceEndMs === current.sourceStartMs && s.scene.id !== current.scene.id);
  if (!previous) return null;
  const a = previous.spans.at(-1), b = current.spans[0];
  return a && b && a.outputEndMs === b.outputStartMs ? previous : null;
}
