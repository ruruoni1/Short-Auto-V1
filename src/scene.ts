import { z } from 'zod';
import { MotionSchema, ResolvedTimelineSchema, SceneTypeSchema } from './models.js';
import type { Asset, Caption, Insert, Motion, Overrides, Production, Scene } from './models.js';
import { TimelineInputSchema, validateResolvedTimeline } from './timeline.js';
import type { Diagnostic } from './validation.js';

const defaults: Record<Scene['type'], Motion['preset']> = {
  HOOK: 'SCALE_IN', KEYWORD: 'SCALE_IN', QUESTION: 'FADE_UP', COMPARE: 'STAGGER',
  EXPLAIN: 'FADE_UP', QUOTE_ANALYSIS: 'FREEZE_FOCUS', RELATION: 'STAGGER', CONCEPT: 'SCALE_IN', RECAP: 'FADE_UP',
};
const PolicySchema = z.strictObject({ motionDefaults: z.partialRecord(SceneTypeSchema, MotionSchema).optional() });
export type SceneRuntimePolicy = z.infer<typeof PolicySchema>;
type Transform = NonNullable<Overrides['scenes'][string]['mainText']>;
export interface SceneOutputSpan { sourceStartMs: number; sourceEndMs: number; outputStartMs: number; outputEndMs: number }
export interface PlannedScene {
  scene: Scene & { motion: Motion };
  sourceStartMs: number;
  sourceEndMs: number;
  spans: SceneOutputSpan[];
  caption: NonNullable<Overrides['scenes'][string]['caption']>;
  mainText: Transform;
  visual: Transform;
  asset: Asset | null;
}
export interface SceneOperation {
  insert: Insert;
  asset: Asset | null;
  outputStartMs: number;
  outputEndMs: number;
  elapsedMs: number;
  /** Null for PAUSE; otherwise effective trim start plus output elapsed time. */
  mediaTimeMs: number | null;
}
export interface SceneRuntimeState {
  outputTimeMs: number;
  kind: 'outside' | 'tts' | 'insert' | 'pause' | 'ending';
  sourceTimeMs: number | null;
  /** Original cue even if captions.show is false or every Scene hides it. */
  caption: Caption | null;
  /** Caption visibility for unassigned ranges; assigned ranges use scenes[].captionVisible. */
  unassignedCaptionVisible: boolean;
  unassignedCaption: Transform;
  scenes: (PlannedScene & { captionVisible: boolean })[];
  operation: SceneOperation | null;
  overlays: SceneOperation[];
  ending: Production['ending'] | null;
}
export interface SceneRuntime {
  durationMs: number;
  /** Detached plan; changing it cannot change subsequent queries. */
  scenes: PlannedScene[];
  /** Integer ms; invalid numeric values throw RangeError. Out-of-range integers return outside. */
  getState(outputTimeMs: number): SceneRuntimeState;
}
export type CreateSceneRuntimeResult =
  | { valid: true; runtime: SceneRuntime; diagnostics: Diagnostic[] }
  | { valid: false; runtime: null; diagnostics: Diagnostic[] };
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined;

/** Validates, snapshots and plans scenes without media, frame or renderer dependencies. */
export function createSceneRuntime(input: unknown, timeline: unknown, policy: SceneRuntimePolicy = {}): CreateSceneRuntimeResult {
  const check = validateResolvedTimeline(input, timeline);
  if (!check.valid) return { valid: false, runtime: null, diagnostics: check.diagnostics };
  const parsedPolicy = PolicySchema.safeParse(policy);
  if (!parsedPolicy.success) return { valid: false, runtime: null, diagnostics: [...check.diagnostics, ...parsedPolicy.error.issues.map(i => ({ severity: 'error' as const, code: 'SCENE_POLICY_SCHEMA', path: `policy.${i.path.join('.')}`, message: i.message }))] };
  const { production: p, source, overrides: o } = TimelineInputSchema.parse(input);
  const output = ResolvedTimelineSchema.parse(timeline);
  const captions = new Map(source.captions.map(c => [c.id, c]));
  const inserts = new Map(p.inserts.map(i => [i.id, i]));
  const plans: PlannedScene[] = p.scenes.map(original => {
    const override = own(o.scenes, original.id);
    const type = override?.type ?? original.type;
    const motion = override?.motion ?? original.motion ?? (parsedPolicy.data.motionDefaults && own(parsedPolicy.data.motionDefaults, type)) ?? { preset: defaults[type], intensity: 'normal' as const };
    const scene = { ...original, type, captionMode: override?.captionMode ?? original.captionMode, motion,
      visual: { ...original.visual, ...(override?.visual?.assetId !== undefined ? { assetId: override.visual.assetId } : {}) } };
    const start = captions.get(original.captionRange.start)!.startMs;
    const end = captions.get(original.captionRange.end)!.endMs;
    const spans = output.segments.flatMap(segment => {
      if (segment.type !== 'tts') return [];
      const a = Math.max(start, segment.sourceStartMs), b = Math.min(end, segment.sourceEndMs);
      return a < b ? [{ sourceStartMs: a, sourceEndMs: b, outputStartMs: segment.outputStartMs + (a - segment.sourceStartMs), outputEndMs: segment.outputStartMs + (b - segment.sourceStartMs) }] : [];
    });
    const { assetId: _assetId, ...visual } = override?.visual ?? {};
    return { scene, sourceStartMs: start, sourceEndMs: end, spans,
      caption: { ...override?.caption, offsetY: override?.caption?.offsetY ?? o.global.captionOffsetY ?? 0 }, mainText: override?.mainText ?? {}, visual,
      asset: scene.visual.assetId ? own(p.assets, scene.visual.assetId) ?? null : null };
  });
  const operation = (segment: { insertId: string; outputStartMs: number; outputEndMs: number }, time: number): SceneOperation => {
    const insert = inserts.get(segment.insertId)!;
    const trim = own(o.inserts, insert.id)?.trim ?? insert.trim;
    const elapsedMs = time - segment.outputStartMs;
    return { insert, asset: insert.assetId ? own(p.assets, insert.assetId) ?? null : null,
      outputStartMs: segment.outputStartMs, outputEndMs: segment.outputEndMs, elapsedMs,
      mediaTimeMs: insert.type === 'PAUSE' ? null : (trim?.startMs ?? 0) + elapsedMs };
  };
  const runtime: SceneRuntime = {
    durationMs: output.durationMs, scenes: structuredClone(plans),
    getState(time) {
      if (!Number.isSafeInteger(time)) throw new RangeError('Output time must be a safe integer millisecond value');
      const state: SceneRuntimeState = { outputTimeMs: time, kind: 'outside', sourceTimeMs: null, caption: null, unassignedCaptionVisible: false, unassignedCaption: { offsetY: o.global.captionOffsetY ?? 0 }, scenes: [], operation: null, overlays: [], ending: null };
      if (time < 0 || time >= output.durationMs) return state;
      const active = output.segments.filter(s => s.outputStartMs <= time && time < s.outputEndMs);
      const base = active.find(s => s.type !== 'overlay')!;
      if (base.type === 'overlay') throw new Error('Validated timeline has no base segment');
      state.kind = base.type;
      state.overlays = active.flatMap(s => s.type === 'overlay' ? [operation(s, time)] : []);
      if (base.type === 'tts') {
        const sourceTime = base.sourceStartMs + (time - base.outputStartMs);
        state.sourceTimeMs = sourceTime;
        state.caption = source.captions.find(c => c.startMs <= sourceTime && sourceTime < c.endMs) ?? null;
        state.scenes = plans.filter(s => s.sourceStartMs <= sourceTime && sourceTime < s.sourceEndMs)
          .map(s => ({ ...s, captionVisible: !!state.caption && p.captions.show && s.scene.captionMode !== 'hidden' }));
        state.unassignedCaptionVisible = !!state.caption && p.captions.show && state.scenes.length === 0;
      } else if ('insertId' in base) state.operation = operation(base, time);
      else state.ending = p.ending;
      return structuredClone(state);
    },
  };
  // All presentation overrides above are now composed. Other upstream diagnostics retain their codes.
  return { valid: true, runtime, diagnostics: check.diagnostics.filter(d => d.code !== 'TIMELINE_DEFERRED_OVERRIDE') };
}
