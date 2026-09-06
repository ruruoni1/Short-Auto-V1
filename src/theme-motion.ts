import { z } from 'zod';
import { ChannelPackSchema, IdSchema, MotionSchema, SceneTypeSchema, TransitionSchema } from './models.js';
import type { Motion, Scene, Theme } from './models.js';
import { createSceneRuntime } from './scene.js';
import type { CreateSceneRuntimeResult, PlannedScene, SceneRuntimePolicy } from './scene.js';
import { TimelineInputSchema } from './timeline.js';
import type { Diagnostic } from './validation.js';

const SelectionSchema = z.strictObject({ packId: IdSchema, themeId: IdSchema, profileId: IdSchema });
const PolicySchema = z.strictObject({ motionDefaults: z.partialRecord(SceneTypeSchema, MotionSchema).optional() });
const diag = (code: string, path: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic => ({ code, path, message, severity });
const errors = (e: z.ZodError): Diagnostic[] => e.issues.map(i => diag('THEME_MOTION_SCHEMA', i.path.join('.'), i.message));
export type FontRole = 'fontPrimaryKR' | 'fontPrimaryJP' | 'fontCaption' | 'fontNumber';
export interface ThemeSelection {
  theme: Theme;
  fonts: Record<FontRole, string>;
  colors: Record<string, string>;
  scenePolicy: SceneRuntimePolicy;
  fontVerification: 'not_performed';
}
export type ResolveThemeResult = { valid: true; selection: ThemeSelection; diagnostics: Diagnostic[] }
  | { valid: false; selection: null; diagnostics: Diagnostic[] };

/** Explicit selection only: no first-theme fallback or channel-specific rules. */
export function resolveTheme(pack: unknown, selection: unknown, policy: SceneRuntimePolicy = {}): ResolveThemeResult {
  const p = ChannelPackSchema.safeParse(pack), s = SelectionSchema.safeParse(selection), o = PolicySchema.safeParse(policy);
  if (!p.success || !s.success || !o.success) return { valid: false, selection: null, diagnostics: [
    ...(!p.success ? errors(p.error) : []), ...(!s.success ? errors(s.error) : []), ...(!o.success ? errors(o.error) : []),
  ] };
  const diagnostics: Diagnostic[] = [];
  if (p.data.id !== s.data.packId) diagnostics.push(diag('THEME_PACK_MISMATCH', 'packId', 'Injected pack does not match project'));
  for (const key of ['themes', 'profiles'] as const) {
    const ids = p.data[key].map(v => v.id);
    if (new Set(ids).size !== ids.length) diagnostics.push(diag('THEME_DUPLICATE_ID', key, 'Duplicate registration is ambiguous'));
  }
  const theme = p.data.themes.find(t => t.id === s.data.themeId);
  const profile = p.data.profiles.find(t => t.id === s.data.profileId);
  if (!theme) diagnostics.push(diag('THEME_NOT_FOUND', 'themeId', 'Theme is not registered in injected pack'));
  if (!profile) diagnostics.push(diag('THEME_PROFILE_NOT_FOUND', 'profileId', 'Profile is not registered in injected pack'));
  if (!theme || !profile || diagnostics.length) return { valid: false, selection: null, diagnostics };
  const motionDefaults: SceneRuntimePolicy['motionDefaults'] = {};
  for (const type of SceneTypeSchema.options) {
    const supplied = o.data.motionDefaults && Object.hasOwn(o.data.motionDefaults, type) ? o.data.motionDefaults[type] : undefined;
    const motion = supplied ?? profile.motionPreset ?? theme.defaultMotion;
    if (motion) motionDefaults[type] = motion;
  }
  return { valid: true, diagnostics, selection: structuredClone({ theme,
    fonts: { fontPrimaryKR: theme.fontPrimaryKR, fontPrimaryJP: theme.fontPrimaryJP, fontCaption: theme.fontCaption, fontNumber: theme.fontNumber },
    colors: theme.colors, scenePolicy: { motionDefaults }, fontVerification: 'not_performed' as const }) };
}

/** Preserves Scene Runtime precedence; never re-resolves an already selected Motion. */
export function createThemedSceneRuntime(input: unknown, timeline: unknown, pack: unknown, policy: SceneRuntimePolicy = {}): CreateSceneRuntimeResult {
  const parsed = TimelineInputSchema.safeParse(input);
  if (!parsed.success) return { valid: false, runtime: null, diagnostics: errors(parsed.error) };
  const p = parsed.data.production;
  const theme = resolveTheme(pack, { packId: p.project.channelPack, themeId: p.settings.theme, profileId: p.project.contentProfile }, policy);
  if (!theme.valid) return { valid: false, runtime: null, diagnostics: theme.diagnostics };
  const registered = ChannelPackSchema.parse(pack).profiles.find(v => v.id === p.project.contentProfile)!;
  if (registered.contentType !== p.project.contentType) return { valid: false, runtime: null, diagnostics: [diag('THEME_PROFILE_CONTENT_TYPE', 'project.contentType', 'Profile content type does not match project')] };
  return createSceneRuntime(input, timeline, theme.selection.scenePolicy);
}

export function selectThemeFont(selection: ThemeSelection, role: FontRole): string {
  if (!Object.hasOwn(selection.fonts, role)) throw new RangeError('Unknown font role');
  return selection.fonts[role];
}
export function selectThemeColor(selection: ThemeSelection, name: string): string | null {
  return Object.hasOwn(selection.colors, name) ? selection.colors[name]! : null;
}
export function selectTransition(original?: Scene['transition'], theme?: Theme): NonNullable<Scene['transition']> {
  return TransitionSchema.parse(original ?? theme?.defaultTransition ?? 'CUT');
}

/** Translation is a fraction of target width/height; scale is multiplicative. */
export interface MotionValues { opacity: number; translateX: number; translateY: number; scale: number }
const identity = (): MotionValues => ({ opacity: 1, translateX: 0, translateY: 0, scale: 1 });
function integer(value: number, name: string, min = -Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`${name} must be a safe integer >= ${min}`);
}
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const progress = (elapsed: number, duration: number): number => duration === 0 ? (elapsed < 0 ? 0 : 1) : clamp(elapsed / duration);
export interface MotionSampleInput {
  motion: Motion; sceneType: Scene['type']; elapsedMs: number; durationMs: number;
  item?: { index: number; count: number };
}
export interface MotionSample {
  supported: boolean; active: boolean; progress: number;
  requestedMotion: Motion; effectiveMotion: Motion;
  values: MotionValues | null; diagnostics: Diagnostic[];
}

/** Pure ms sampling. Invalid numbers throw; missing visual context is an explicit unsupported result. */
export function sampleMotion(input: MotionSampleInput): MotionSample {
  integer(input.elapsedMs, 'elapsedMs'); integer(input.durationMs, 'durationMs', 0);
  const requestedMotion = MotionSchema.parse(input.motion);
  const type = SceneTypeSchema.parse(input.sceneType);
  if (requestedMotion.durationMs !== undefined) integer(requestedMotion.durationMs, 'motion.durationMs', 1);
  if (input.item) {
    integer(input.item.count, 'item.count', 1); integer(input.item.index, 'item.index', 0);
    if (input.item.index >= input.item.count) throw new RangeError('item.index must be below item.count');
  }
  const effectiveMotion = { ...requestedMotion };
  const diagnostics: Diagnostic[] = [];
  if (effectiveMotion.intensity === 'strong' && !['HOOK', 'KEYWORD', 'CONCEPT'].includes(type)) {
    effectiveMotion.intensity = 'normal';
    diagnostics.push(diag('MOTION_INTENSITY_LIMITED', 'motion.intensity', 'Strong motion is limited to HOOK, KEYWORD and CONCEPT; sampled as normal', 'warning'));
  }
  const preset = effectiveMotion.preset;
  const continuous = preset === 'SLOW_ZOOM' || preset === 'PAN';
  const windowMs = Math.min(input.durationMs, effectiveMotion.durationMs ?? (continuous ? input.durationMs : 400));
  let t = progress(input.elapsedMs, windowMs);
  if (preset === 'STAGGER' && input.item) {
    // Last item starts halfway through the window; all items finish within the scene.
    const delay = input.item.count === 1 ? 0 : (input.item.index / (input.item.count - 1)) * windowMs * 0.5;
    t = progress(input.elapsedMs - delay, windowMs - delay);
  }
  const result: MotionSample = { supported: true, active: input.elapsedMs >= 0 && input.elapsedMs < input.durationMs,
    progress: t, requestedMotion, effectiveMotion, values: identity(), diagnostics };
  if (preset === 'FREEZE_FOCUS' || (preset === 'STAGGER' && !input.item)) {
    result.supported = false; result.values = null;
    diagnostics.push(diag(preset === 'FREEZE_FOCUS' ? 'MOTION_FREEZE_FOCUS_UNSUPPORTED' : 'MOTION_STAGGER_CONTEXT_REQUIRED', 'motion.preset',
      preset === 'FREEZE_FOCUS' ? 'Requires media frame/time and focus geometry; freeze and focus are not implemented' : 'STAGGER requires item index and count'));
    return result;
  }
  const amplitude = { subtle: 0.015, normal: 0.03, strong: 0.05 }[effectiveMotion.intensity];
  const rest = (1 - t) ** 3;
  const v = result.values!;
  switch (preset) {
    case 'FADE_UP': case 'STAGGER': v.opacity = 1 - rest; v.translateY = amplitude * rest; break;
    case 'SCALE_IN': v.opacity = 1 - rest; v.scale = 1 - amplitude * rest; break;
    case 'SLIDE_IN': v.opacity = 1 - rest; v.translateX = -amplitude * rest; break;
    case 'SLOW_ZOOM': v.scale = 1 + amplitude * t; break;
    case 'PAN': v.translateX = amplitude * (t - 0.5); v.scale = 1 + amplitude; break;
    case 'CUT': break;
  }
  return result;
}

/** Use only active TTS plans from getState; source time prevents restart/advance across stop inserts. */
export function samplePlannedSceneMotion(plan: PlannedScene, sourceTimeMs: number, item?: MotionSampleInput['item']): MotionSample {
  integer(sourceTimeMs, 'sourceTimeMs'); integer(plan.sourceStartMs, 'sourceStartMs', 0); integer(plan.sourceEndMs, 'sourceEndMs', 0);
  const elapsedMs = sourceTimeMs - plan.sourceStartMs;
  return sampleMotion({ motion: plan.scene.motion, sceneType: plan.scene.type, elapsedMs,
    durationMs: plan.sourceEndMs - plan.sourceStartMs, ...(item ? { item } : {}) });
}

export interface TransitionSample {
  supported: boolean; progress: number; incoming: MotionValues | null; outgoing: MotionValues | null; diagnostics: Diagnostic[];
}
/** elapsedMs is relative to caller-provided transition start, never global wall time. */
export function sampleTransition(transition: NonNullable<Scene['transition']>, elapsedMs: number, durationMs = 250): TransitionSample {
  TransitionSchema.parse(transition); integer(elapsedMs, 'elapsedMs'); integer(durationMs, 'durationMs', 0);
  const t = transition === 'CUT' ? (elapsedMs < 0 ? 0 : 1) : progress(elapsedMs, durationMs);
  if (transition === 'MATCH') return { supported: false, progress: t, incoming: null, outgoing: null,
    diagnostics: [diag('TRANSITION_MATCH_UNSUPPORTED', 'transition', 'Requires corresponding outgoing/incoming visual geometry; match mapping is not implemented')] };
  const incoming = identity(), outgoing = identity();
  if (transition === 'PUSH') { incoming.translateX = 1 - t; outgoing.translateX = -t; }
  else { incoming.opacity = t; outgoing.opacity = 1 - t; }
  return { supported: true, progress: t, incoming, outgoing, diagnostics: [] };
}
