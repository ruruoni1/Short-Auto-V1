import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MotionSchema, SceneTypeSchema, createThemedSceneRuntime, resolveTheme, resolveTimeline, sampleMotion, samplePlannedSceneMotion, sampleTransition, selectThemeColor, selectThemeFont, selectTransition } from '../src/index.js';
import type { Motion, SceneRuntimePolicy } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

function fixture() {
  const w = exampleWorkspace(), pack = w.packs[0]!, input = w.projects[0]!;
  pack.id = 'other_pack'; input.production.project.channelPack = pack.id;
  const theme = pack.themes[0]!;
  theme.fontPrimaryKR = 'Test KR'; theme.fontPrimaryJP = 'Test JP'; theme.fontCaption = 'Test Caption'; theme.fontNumber = 'Test Number';
  theme.colors = { background: '#abcdef', accent: '#123456' };
  return { pack, input, theme, selection: { packId: pack.id, themeId: theme.id, profileId: input.production.project.contentProfile } };
}
const motion = (preset: Motion['preset'], intensity: Motion['intensity'] = 'normal'): Motion => ({ preset, intensity });
const sample = (preset: Motion['preset'], elapsedMs = 200, durationMs = 1000) => sampleMotion({ motion: motion(preset), sceneType: 'HOOK', elapsedMs, durationMs, item: { index: 0, count: 1 } });

test('theme selects injected fonts/colors; no channel or font-availability assumptions', () => {
  const f = fixture(), before = structuredClone(f.pack);
  const r = resolveTheme(f.pack, f.selection); assert.ok(r.valid);
  assert.equal(selectThemeFont(r.selection, 'fontPrimaryKR'), 'Test KR');
  assert.equal(selectThemeFont(r.selection, 'fontPrimaryJP'), 'Test JP');
  assert.equal(selectThemeFont(r.selection, 'fontCaption'), 'Test Caption');
  assert.equal(selectThemeFont(r.selection, 'fontNumber'), 'Test Number');
  assert.equal(selectThemeColor(r.selection, 'accent'), '#123456');
  assert.equal(selectThemeColor(r.selection, 'constructor'), null);
  assert.equal(selectThemeColor(r.selection, 'absent'), null);
  assert.equal(r.selection.fontVerification, 'not_performed');
  r.selection.theme.colors.accent = 'changed'; r.selection.colors.background = 'changed';
  assert.deepEqual(f.pack, before);
});
for (const kind of ['pack', 'theme', 'profile', 'duplicateTheme', 'duplicateProfile', 'schema', 'policy'] as const) {
  test(`theme rejects ${kind}`, () => {
    const f = fixture(); let p: unknown = f.pack; let policy: SceneRuntimePolicy = {};
    if (kind === 'pack') f.selection.packId = 'missing';
    if (kind === 'theme') f.selection.themeId = 'constructor';
    if (kind === 'profile') f.selection.profileId = 'missing';
    if (kind === 'duplicateTheme') f.pack.themes.push(structuredClone(f.theme));
    if (kind === 'duplicateProfile') f.pack.profiles.push(structuredClone(f.pack.profiles[0]!));
    if (kind === 'schema') p = { ...f.pack, extra: true };
    if (kind === 'policy') policy = { motionDefaults: { BAD: motion('CUT') } } as SceneRuntimePolicy;
    const r = resolveTheme(p, f.selection, policy); assert.equal(r.valid, false); assert.equal(r.selection, null); assert.ok(r.diagnostics.length);
  });
}
test('theme default and profile preset feed policy; explicit per-type policy wins', () => {
  const f = fixture(); f.theme.defaultMotion = motion('PAN'); f.pack.profiles[0]!.motionPreset = motion('SLIDE_IN');
  const r = resolveTheme(f.pack, f.selection, { motionDefaults: { HOOK: motion('CUT') } }); assert.ok(r.valid);
  assert.deepEqual(r.selection.scenePolicy.motionDefaults!.HOOK, motion('CUT'));
  assert.deepEqual(r.selection.scenePolicy.motionDefaults!.EXPLAIN, motion('SLIDE_IN'));
  delete f.pack.profiles[0]!.motionPreset;
  const t = resolveTheme(f.pack, f.selection); assert.ok(t.valid); assert.deepEqual(t.selection.scenePolicy.motionDefaults!.EXPLAIN, motion('PAN'));
});
test('transition precedence original > theme > CUT including explicit CUT', () => {
  const f = fixture(); f.theme.defaultTransition = 'FADE';
  assert.equal(selectTransition('CUT', f.theme), 'CUT'); assert.equal(selectTransition(undefined, f.theme), 'FADE');
  assert.equal(selectTransition(), 'CUT'); assert.equal(selectTransition('MATCH', f.theme), 'MATCH');
});
for (const stage of ['override', 'original', 'policy', 'profile', 'theme', 'default'] as const) {
  test(`Scene Runtime precedence: ${stage}`, () => {
    const f = fixture(); const s = f.input.production.scenes[0]!;
    if (stage !== 'default') f.theme.defaultMotion = motion('PAN');
    if (['profile', 'policy', 'original', 'override'].includes(stage)) f.pack.profiles[0]!.motionPreset = motion('SLOW_ZOOM');
    const policy = ['policy', 'original', 'override'].includes(stage) ? { motionDefaults: { EXPLAIN: motion('SLIDE_IN') } } : {};
    if (['original', 'override'].includes(stage)) s.motion = motion('SCALE_IN');
    if (stage === 'override') f.input.overrides.scenes[s.id] = { motion: motion('CUT'), visual: { scale: 1.4 }, caption: { offsetY: 30 } };
    const before = structuredClone(f.input), t = resolveTimeline(f.input); assert.ok(t.valid);
    const r = createThemedSceneRuntime(f.input, t.timeline, f.pack, policy); assert.ok(r.valid);
    const expected = { override: 'CUT', original: 'SCALE_IN', policy: 'SLIDE_IN', profile: 'SLOW_ZOOM', theme: 'PAN', default: 'FADE_UP' };
    assert.equal(r.runtime.scenes[0]!.scene.motion.preset, expected[stage]); assert.deepEqual(f.input, before);
    if (stage === 'override') { assert.equal(r.runtime.scenes[0]!.visual.scale, 1.4); assert.equal(r.runtime.scenes[0]!.caption.offsetY, 30); }
  });
}
test('effective overridden type selects policy; raw transition remains unchanged', () => {
  const f = fixture(), s = f.input.production.scenes[0]!; s.transition = 'MATCH';
  f.input.overrides.scenes[s.id] = { type: 'HOOK' };
  const t = resolveTimeline(f.input); assert.ok(t.valid);
  const r = createThemedSceneRuntime(f.input, t.timeline, f.pack, { motionDefaults: { HOOK: motion('CUT') } }); assert.ok(r.valid);
  assert.equal(r.runtime.scenes[0]!.scene.motion.preset, 'CUT'); assert.equal(r.runtime.scenes[0]!.scene.transition, 'MATCH');
});
test('adapter rejects invalid timeline, pack/profile mismatch and invalid input', () => {
  const f = fixture(), t = resolveTimeline(f.input); assert.ok(t.valid);
  assert.equal(createThemedSceneRuntime({}, t.timeline, f.pack).valid, false);
  assert.equal(createThemedSceneRuntime(f.input, {}, f.pack).valid, false);
  f.pack.id = 'wrong'; assert.equal(createThemedSceneRuntime(f.input, t.timeline, f.pack).valid, false);
  f.pack.id = f.selection.packId; f.pack.profiles[0]!.contentType = 'learning_short';
  assert.equal(createThemedSceneRuntime(f.input, t.timeline, f.pack).valid, false);
});
for (const preset of MotionSchema.shape.preset.options) {
  for (const intensity of ['subtle', 'normal', 'strong'] as const) {
    test(`${preset}/${intensity} is deterministic and bounded`, () => {
      for (const time of [-100, 0, 50, 200, 400, 999, 1000, Number.MAX_SAFE_INTEGER]) {
        const input = { motion: motion(preset, intensity), sceneType: 'HOOK' as const, elapsedMs: time, durationMs: 1000, item: { index: 1, count: 3 } };
        const before = structuredClone(input), a = sampleMotion(input);
        sample('CUT', 0); assert.deepEqual(sampleMotion(input), a); assert.deepEqual(input, before);
        assert.equal(a.active, time >= 0 && time < 1000);
        if (preset === 'FREEZE_FOCUS') { assert.equal(a.supported, false); assert.equal(a.values, null); continue; }
        assert.ok(a.values); assert.ok(a.progress >= 0 && a.progress <= 1);
        assert.ok(Object.values(a.values).every(Number.isFinite));
        assert.ok(a.values.opacity >= 0 && a.values.opacity <= 1);
        assert.ok(Math.abs(a.values.translateX) <= 0.05 && Math.abs(a.values.translateY) <= 0.05);
        assert.ok(a.values.scale >= 0.95 && a.values.scale <= 1.05);
      }
    });
  }
}
test('entrance formulas use cubic ease-out with exact known midpoint/endpoints', () => {
  assert.deepEqual(sample('FADE_UP', 0).values, { opacity: 0, translateX: 0, translateY: 0.03, scale: 1 });
  assert.equal(sample('FADE_UP').values!.opacity, 0.875);
  assert.equal(sample('FADE_UP').values!.translateY, 0.00375);
  assert.equal(sample('SCALE_IN').values!.scale, 0.99625);
  assert.equal(sample('SLIDE_IN').values!.translateX, -0.00375);
  assert.deepEqual(sample('FADE_UP', 400).values, sample('CUT').values);
});
test('zoom/pan are small, linear and scene-long by default', () => {
  assert.equal(sample('SLOW_ZOOM', 500).values!.scale, 1.015);
  assert.equal(sample('PAN', 0).values!.translateX, -0.015);
  assert.equal(sample('PAN', 500).values!.translateX, 0);
  assert.equal(sample('PAN', 1000).values!.translateX, 0.015);
});
test('explicit duration respected, clipped to scene and holds at completion', () => {
  const input = { motion: { ...motion('SLOW_ZOOM'), durationMs: 200 }, sceneType: 'HOOK' as const, elapsedMs: 200, durationMs: 1000 };
  assert.equal(sampleMotion(input).values!.scale, 1.03);
  input.motion.durationMs = 2000; input.elapsedMs = 500;
  assert.equal(sampleMotion(input).values!.scale, 1.015);
});
test('STAGGER needs item context; stagger fits short windows and count=1', () => {
  const input = { motion: motion('STAGGER'), sceneType: 'COMPARE' as const, elapsedMs: 100, durationMs: 400 };
  const absent = sampleMotion(input); assert.equal(absent.supported, false); assert.equal(absent.values, null);
  const first = sampleMotion({ ...input, item: { index: 0, count: 3 } });
  const last = sampleMotion({ ...input, item: { index: 2, count: 3 } });
  assert.ok(first.values!.opacity > last.values!.opacity); assert.equal(last.values!.opacity, 0);
  assert.deepEqual(sampleMotion({ ...input, item: { index: 0, count: 1 } }).values, first.values);
  const end = sampleMotion({ ...input, elapsedMs: 1, durationMs: 1, item: { index: 999999, count: 1000000 } });
  assert.equal(end.values!.opacity, 1); assert.equal(end.active, false);
});
for (const type of SceneTypeSchema.options) {
  test(`strong policy for ${type} preserves requested input`, () => {
    const input = { motion: motion('PAN', 'strong'), sceneType: type, elapsedMs: 1000, durationMs: 1000 };
    const r = sampleMotion(input), allowed = ['HOOK', 'KEYWORD', 'CONCEPT'].includes(type);
    assert.equal(r.effectiveMotion.intensity, allowed ? 'strong' : 'normal');
    assert.equal(r.requestedMotion.intensity, 'strong'); assert.equal(input.motion.intensity, 'strong');
    assert.equal(r.diagnostics.some(d => d.code === 'MOTION_INTENSITY_LIMITED'), !allowed);
  });
}
test('FREEZE_FOCUS and MATCH never claim visual support', () => {
  const f = sample('FREEZE_FOCUS'); assert.equal(f.values, null); assert.equal(f.diagnostics[0]!.code, 'MOTION_FREEZE_FOCUS_UNSUPPORTED');
  const m = sampleTransition('MATCH', 50); assert.equal(m.supported, false); assert.equal(m.incoming, null); assert.equal(m.outgoing, null);
  assert.equal(m.diagnostics[0]!.code, 'TRANSITION_MATCH_UNSUPPORTED');
});
test('transition CUT is immediate, FADE crossfades and PUSH moves both layers', () => {
  assert.equal(sampleTransition('CUT', -1).incoming!.opacity, 0);
  assert.equal(sampleTransition('CUT', 0).incoming!.opacity, 1);
  const fade = sampleTransition('FADE', 125); assert.equal(fade.incoming!.opacity, 0.5); assert.equal(fade.outgoing!.opacity, 0.5);
  const push = sampleTransition('PUSH', 125); assert.equal(push.incoming!.translateX, 0.5); assert.equal(push.outgoing!.translateX, -0.5);
  assert.equal(sampleTransition('FADE', -1).progress, 0); assert.equal(sampleTransition('PUSH', 251).progress, 1);
});
test('zero duration is inactive settled motion and instantaneous transition; no NaN', () => {
  for (const preset of MotionSchema.shape.preset.options) {
    const s = sample(preset, 0, 0); assert.equal(s.active, false); assert.equal(s.progress, 1);
    if (s.values) assert.ok(Object.values(s.values).every(Number.isFinite));
  }
  assert.equal(sampleTransition('FADE', 0, 0).incoming!.opacity, 1);
  assert.equal(sampleTransition('FADE', -1, 0).incoming!.opacity, 0);
});
for (const value of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`reject unsafe numeric input ${value}`, () => {
    assert.throws(() => sample('CUT', value), RangeError); assert.throws(() => sample('PAN', 0, value), RangeError);
    assert.throws(() => sampleTransition('CUT', value), RangeError); assert.throws(() => sampleTransition('FADE', 0, value), RangeError);
    assert.throws(() => sampleMotion({ motion: motion('STAGGER'), sceneType: 'HOOK', elapsedMs: 0, durationMs: 100, item: { index: value, count: 2 } }), RangeError);
  });
}
test('negative duration, invalid item bounds, invalid motion duration are rejected', () => {
  assert.throws(() => sample('CUT', 0, -1), RangeError);
  for (const item of [{ index: 0, count: 0 }, { index: -1, count: 2 }, { index: 2, count: 2 }, { index: 0, count: Infinity }]) {
    assert.throws(() => sampleMotion({ motion: motion('STAGGER'), sceneType: 'HOOK', elapsedMs: 0, durationMs: 100, item }), RangeError);
  }
  for (const durationMs of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => sampleMotion({ motion: { ...motion('CUT'), durationMs }, sceneType: 'HOOK', elapsedMs: 0, durationMs: 100 }));
  }
});
test('Source-time adapter resumes motion across stop insert without advancing or restarting', () => {
  const f = fixture(); f.theme.defaultMotion = motion('SLOW_ZOOM');
  const t = resolveTimeline(f.input); assert.ok(t.valid);
  const r = createThemedSceneRuntime(f.input, t.timeline, f.pack); assert.ok(r.valid);
  const before = r.runtime.getState(1999), stop = r.runtime.getState(2000), after = r.runtime.getState(3000);
  assert.equal(stop.scenes.length, 0); assert.equal(stop.sourceTimeMs, null);
  const a = samplePlannedSceneMotion(before.scenes[0]!, before.sourceTimeMs!);
  const b = samplePlannedSceneMotion(after.scenes[0]!, after.sourceTimeMs!);
  assert.equal(b.progress, 0.5); assert.ok(b.values!.scale > a.values!.scale);
  f.theme.defaultMotion = motion('CUT'); r.runtime.scenes[0]!.scene.motion = motion('CUT');
  assert.equal(r.runtime.getState(3000).scenes[0]!.scene.motion.preset, 'SLOW_ZOOM');
});
