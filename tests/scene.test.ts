import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneRuntime, resolveTimeline, SceneTypeSchema } from '../src/index.js';
import type { TimelineInput, SceneRuntime, SceneRuntimePolicy } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

function fixture(): TimelineInput {
  const { production, source, overrides } = exampleWorkspace().projects[0]!;
  production.inserts = [];
  source.durationMs = 6000;
  source.captions = [{ id: 2, startMs: 500, endMs: 2000, text: ' 日本語\r\n 원문 ' }, { id: 9, startMs: 3000, endMs: 4500, text: '두 번째' }];
  production.scenes[0]!.captionRange = { start: 2, end: 9 };
  return { production, source, overrides };
}
function runtime(input = fixture(), policy?: SceneRuntimePolicy): SceneRuntime {
  const timeline = resolveTimeline(input);
  assert.ok(timeline.valid, JSON.stringify(timeline.diagnostics));
  const result = createSceneRuntime(input, timeline.timeline, policy);
  assert.ok(result.valid, JSON.stringify(result.diagnostics));
  return result.runtime;
}
for (const [type, preset] of Object.entries({ HOOK: 'SCALE_IN', KEYWORD: 'SCALE_IN', QUESTION: 'FADE_UP', COMPARE: 'STAGGER', EXPLAIN: 'FADE_UP', QUOTE_ANALYSIS: 'FREEZE_FOCUS', RELATION: 'STAGGER', CONCEPT: 'SCALE_IN', RECAP: 'FADE_UP' })) {
  test(`${type} resolves deterministic motion without channel registration`, () => {
    const x = fixture(); x.production.scenes[0]!.type = SceneTypeSchema.parse(type);
    const r = runtime(x);
    assert.deepEqual(r.scenes[0]!.scene.motion, { preset, intensity: 'normal' });
    assert.deepEqual(r.getState(600), runtime(x).getState(600));
  });
}
test('manual oracle: half-open source caption, scene and silence boundaries', () => {
  const r = runtime();
  for (const [time, captionId, count] of [[0, null, 0], [499, null, 0], [500, 2, 1], [1999, 2, 1], [2000, null, 1], [2999, null, 1], [3000, 9, 1], [4499, 9, 1], [4500, null, 0], [5999, null, 0]] as const) {
    const s = r.getState(time);
    assert.equal(s.kind, 'tts'); assert.equal(s.sourceTimeMs, time);
    assert.equal(s.caption?.id ?? null, captionId); assert.equal(s.scenes.length, count);
  }
  assert.equal(r.getState(500).caption!.text, ' 日本語\r\n 원문 ');
  assert.deepEqual(r.scenes[0]!.spans, [{ sourceStartMs: 500, sourceEndMs: 4500, outputStartMs: 500, outputEndMs: 4500 }]);
});
test('manual oracle: insert, pause, parallel overlays, ending and effective media trim', () => {
  const x = fixture();
  x.production.inserts = [
    { id: 'clip', type: 'ANIME_CLIP', timingMode: 'insert', assetId: 'clip01', anchor: { type: 'caption_after', captionId: 2 }, durationMs: 200 },
    { id: 'pause', type: 'PAUSE', timingMode: 'pause', anchor: { type: 'source_time', timeMs: 2000 }, durationMs: 300 },
    { id: 'overlay1', type: 'MEDIA', timingMode: 'overlay', assetId: 'clip01', anchor: { type: 'source_time', timeMs: 1900 }, durationMs: 1200 },
    { id: 'overlay2', type: 'MEDIA', timingMode: 'overlay', assetId: 'clip01', anchor: { type: 'source_time', timeMs: 1900 }, durationMs: 100 },
  ];
  x.overrides.inserts.clip = { trim: { startMs: 700, endMs: 1100 } };
  x.production.ending = { enabled: true, durationMs: 500, type: 'end', message: '끝' };
  const r = runtime(x);
  assert.equal(r.durationMs, 7200);
  assert.deepEqual(r.getState(1900).overlays.map(o => o.insert.id), ['overlay1', 'overlay2']);
  assert.equal(r.getState(1999).caption!.id, 2);
  for (const [t, kind] of [[2000, 'insert'], [2399, 'insert'], [2400, 'pause'], [2699, 'pause']] as const) {
    const s = r.getState(t); assert.equal(s.kind, kind); assert.equal(s.caption, null);
    assert.equal(s.sourceTimeMs, null); assert.deepEqual(s.scenes, []); assert.equal(s.overlays.length, 1);
  }
  assert.equal(r.getState(2100).operation!.mediaTimeMs, 800);
  assert.equal(r.getState(2400).operation!.mediaTimeMs, null);
  assert.equal(r.getState(2700).sourceTimeMs, 2000);
  assert.equal(r.getState(3099).overlays.length, 1); assert.equal(r.getState(3100).overlays.length, 0);
  assert.equal(r.getState(3700).caption!.id, 9);
  assert.equal(r.getState(6700).kind, 'ending'); assert.equal(r.getState(6700).ending!.message, '끝');
  assert.equal(r.getState(7200).kind, 'outside');
  assert.deepEqual(r.scenes[0]!.spans, [
    { sourceStartMs: 500, sourceEndMs: 2000, outputStartMs: 500, outputEndMs: 2000 },
    { sourceStartMs: 2000, sourceEndMs: 4500, outputStartMs: 2700, outputEndMs: 5200 },
  ]);
});
test('overlapping scenes preserve production order, distinct caption modes and warnings', () => {
  const x = fixture(); const second = structuredClone(x.production.scenes[0]!);
  second.id = 'second'; second.captionMode = 'hidden'; x.production.scenes.unshift(second);
  const r = runtime(x); const s = r.getState(500);
  assert.deepEqual(s.scenes.map(s => [s.scene.id, s.captionVisible]), [['second', false], ['scene_001', true]]);
  const result = createSceneRuntime(x, resolveTimeline(x).timeline);
  assert.ok(result.diagnostics.some(d => d.code === 'TIMELINE_SCENE_OVERLAP'));
});
test('unassigned caption stays available; no synthetic EXPLAIN is invented', () => {
  const x = fixture(); x.production.scenes[0]!.captionRange.end = 2;
  const s = runtime(x).getState(3000); assert.deepEqual(s.scenes, []);
  assert.equal(s.caption!.id, 9); assert.equal(s.unassignedCaptionVisible, true);
});
test('caption show and hidden affect display only, never original text', () => {
  const x = fixture(); x.production.captions.show = false;
  assert.equal(runtime(x).getState(500).scenes[0]!.captionVisible, false);
  assert.equal(runtime(x).getState(500).caption!.id, 2);
  x.production.scenes = []; assert.equal(runtime(x).getState(500).unassignedCaptionVisible, false);
});
test('presentation composition uses local over global offset, replaces lines, preserves content/strategy', () => {
  const x = fixture(); x.overrides.global.captionOffsetY = 40;
  x.overrides.scenes.scene_001 = { type: 'KEYWORD', captionMode: 'subtle', caption: { offsetY: 0, lines: ['표시만'], scale: 2 }, mainText: { offsetX: 3 }, visual: { assetId: 'clip01', width: 500 }, motion: { preset: 'PAN', intensity: 'subtle' } };
  const r = runtime(x); const p = r.scenes[0]!;
  assert.equal(p.scene.type, 'KEYWORD'); assert.equal(p.caption.offsetY, 0); assert.deepEqual(p.caption.lines, ['표시만']);
  assert.equal(p.scene.motion.preset, 'PAN'); assert.equal(p.visual.width, 500); assert.equal(p.mainText.offsetX, 3);
  assert.equal(p.asset!.status, 'required'); assert.equal(p.scene.visual.strategy, 'text_only');
  assert.deepEqual(p.scene.content, x.production.scenes[0]!.content);
  assert.equal(r.getState(500).caption!.text, x.source.captions[0]!.text);
  delete x.overrides.scenes.scene_001!.caption!.offsetY;
  assert.equal(runtime(x).scenes[0]!.caption.offsetY, 40);
  assert.ok(!createSceneRuntime(x, resolveTimeline(x).timeline).diagnostics.some(d => d.code === 'TIMELINE_DEFERRED_OVERRIDE'));
});
test('motion precedence override > explicit > injected effective type > deterministic default', () => {
  const x = fixture(); x.overrides.scenes.scene_001 = { type: 'HOOK' };
  const policy: SceneRuntimePolicy = { motionDefaults: { HOOK: { preset: 'CUT', intensity: 'subtle' } } };
  assert.equal(runtime(x, policy).scenes[0]!.scene.motion.preset, 'CUT');
  x.production.scenes[0]!.motion = { preset: 'PAN', intensity: 'normal' };
  assert.equal(runtime(x, policy).scenes[0]!.scene.motion.preset, 'PAN');
  x.overrides.scenes.scene_001!.motion = { preset: 'SLIDE_IN', intensity: 'strong' };
  assert.equal(runtime(x, policy).scenes[0]!.scene.motion.preset, 'SLIDE_IN');
});
for (const id of ['constructor', 'toString', 'hasOwnProperty']) test(`own-property Scene/Asset/Insert references: ${id}`, () => {
  const x = fixture(); x.production.scenes[0]!.id = id;
  assert.equal(runtime(x).scenes[0]!.scene.type, 'EXPLAIN');
  x.overrides.scenes[id] = { type: 'RECAP', visual: { assetId: id } };
  assert.equal(createSceneRuntime(x, resolveTimeline(x).timeline).valid, false);
  x.production.assets[id] = { type: 'video', status: 'missing' };
  x.production.inserts = [{ id, type: 'MEDIA', timingMode: 'insert', anchor: { type: 'source_time', timeMs: 0 }, durationMs: 100, assetId: id }];
  assert.equal(runtime(x).getState(0).operation!.asset!.status, 'missing');
  assert.equal(runtime(x).scenes[0]!.scene.type, 'RECAP');
  x.overrides.inserts[id] = { trim: { startMs: 50, endMs: 100 } };
  assert.equal(runtime(x).getState(0).operation!.mediaTimeMs, 50);
});
test('empty captions/source silence need no scenes', () => {
  const x = fixture(); x.source.captions = []; x.production.scenes = [];
  const s = runtime(x).getState(500); assert.equal(s.kind, 'tts'); assert.equal(s.caption, null); assert.deepEqual(s.scenes, []);
});
test('invalid/stale timeline and unsupported outputTiming return no runtime', () => {
  const x = fixture(); const t = resolveTimeline(x).timeline!;
  t.productionRevision++;
  assert.equal(createSceneRuntime(x, t).runtime, null);
  t.productionRevision--;
  x.overrides.scenes.scene_001 = { outputTiming: { startMs: 0, endMs: 100 } };
  const result = createSceneRuntime(x, t); assert.equal(result.runtime, null);
  assert.ok(result.diagnostics.some(d => d.code === 'TIMELINE_UNSUPPORTED_OUTPUT_TIMING'));
  assert.equal(createSceneRuntime(null, null).valid, false);
});
test('invalid policy yields structured diagnostic', () => {
  const x = fixture(); const result = createSceneRuntime(x, resolveTimeline(x).timeline, { motionDefaults: { EXPLAIN: { preset: 'RANDOM' } } } as unknown as SceneRuntimePolicy);
  assert.equal(result.runtime, null); assert.ok(result.diagnostics.some(d => d.code === 'SCENE_POLICY_SCHEMA'));
});
test('invalid numeric query throws; integral outside boundaries return empty state', () => {
  const r = runtime();
  for (const t of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => r.getState(t), RangeError);
  for (const t of [-1, 6000, 6001]) { const s = r.getState(t); assert.equal(s.kind, 'outside'); assert.equal(s.caption, null); assert.deepEqual(s.scenes, []); }
});
test('frozen inputs, caller edits and result edits cannot mutate runtime snapshot', () => {
  const x = fixture(); const t = resolveTimeline(x).timeline!;
  const before = structuredClone(x);
  function freeze(v: unknown) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(x); freeze(t);
  const result = createSceneRuntime(x, t); assert.ok(result.valid);
  const r = result.runtime, expected = r.getState(500);
  r.scenes[0]!.scene.content.mainText = 'changed';
  const state = r.getState(500); state.caption!.text = 'changed'; state.scenes[0]!.scene.motion.preset = 'CUT';
  assert.deepEqual(r.getState(500), expected); assert.deepEqual(x, before);
  const mutable = fixture(), mutableTimeline = resolveTimeline(mutable).timeline!;
  const built = createSceneRuntime(mutable, mutableTimeline); assert.ok(built.valid);
  mutable.source.captions[0]!.text = 'edited later'; mutableTimeline.segments[0]!.outputEndMs = 1;
  assert.equal(built.runtime.getState(500).caption!.text, before.source.captions[0]!.text);
});
test('split validated TTS preserves exact scene coverage', () => {
  const x = fixture(), t = resolveTimeline(x).timeline!;
  t.segments = [{ type: 'tts', sourceStartMs: 0, sourceEndMs: 1000, outputStartMs: 0, outputEndMs: 1000 }, { type: 'tts', sourceStartMs: 1000, sourceEndMs: 6000, outputStartMs: 1000, outputEndMs: 6000 }];
  const result = createSceneRuntime(x, t); assert.ok(result.valid);
  assert.equal(result.runtime.getState(1000).caption!.id, 2); assert.equal(result.runtime.scenes[0]!.spans.length, 2);
});

test('global caption offset applies to unassigned narration too', () => {
  const x = fixture(); x.production.scenes = []; x.overrides.global.captionOffsetY = -25;
  assert.deepEqual(runtime(x).getState(500).unassignedCaption, { offsetY: -25 });
});
test('end-of-source stops precede ending and never retain a scene or caption', () => {
  const x = fixture(); x.production.inserts = [{ id: 'tail', type: 'PAUSE', timingMode: 'pause', anchor: { type: 'source_time', timeMs: 6000 }, durationMs: 100 }];
  x.production.ending = { enabled: true, durationMs: 100, type: 'end', message: '' };
  const r = runtime(x);
  assert.equal(r.getState(6000).kind, 'pause'); assert.equal(r.getState(6100).kind, 'ending');
  assert.equal(r.getState(6200).kind, 'outside'); assert.deepEqual(r.getState(6000).scenes, []);
});
