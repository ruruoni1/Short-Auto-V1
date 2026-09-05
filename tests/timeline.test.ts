import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeline, validateResolvedTimeline, ResolvedTimelineSchema, parseSrt } from '../src/index.js';
import type { TimelineInput, Insert, ResolvedTimeline } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

function fixture(): TimelineInput {
  const { production, source, overrides } = exampleWorkspace().projects[0]!;
  production.inserts = [];
  source.durationMs = 6000;
  source.captions = [{ id: 1, startMs: 500, endMs: 2000, text: '첫 문장' }, { id: 3, startMs: 3000, endMs: 4500, text: '次の文' }];
  production.scenes[0]!.captionRange.end = 3;
  return { production, source, overrides };
}
function insert(id: string, time: number, mode: Insert['timingMode'] = 'insert', durationMs = 1000): Insert {
  return mode === 'pause'
    ? { id, type: 'PAUSE', timingMode: mode, anchor: { type: 'source_time', timeMs: time }, durationMs }
    : { id, type: 'MEDIA', timingMode: mode, anchor: { type: 'source_time', timeMs: time }, durationMs, assetId: 'clip01' };
}
function resolve(input: TimelineInput): ResolvedTimeline {
  const result = resolveTimeline(input);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.ok(result.timeline);
  assert.equal(ResolvedTimelineSchema.safeParse(result.timeline).success, true);
  assert.equal(validateResolvedTimeline(input, result.timeline).valid, true);
  return result.timeline;
}
function rejects(input: unknown, code: string) {
  const result = resolveTimeline(input);
  assert.equal(result.valid, false);
  assert.equal(result.timeline, null);
  assert.ok(result.diagnostics.some(d => d.code === code), JSON.stringify(result.diagnostics));
}

test('preserves leading, between-cue and trailing silence as one complete TTS span', () => {
  const result = resolve(fixture());
  assert.equal(result.durationMs, 6000);
  assert.deepEqual(result.segments, [{ type: 'tts', sourceStartMs: 0, sourceEndMs: 6000, outputStartMs: 0, outputEndMs: 6000 }]);
});
test('manual oracle: boundaries, silence, concurrent stops, overlay and ending', () => {
  const input = fixture();
  input.production.inserts = [insert('before', 0, 'pause', 100), insert('a', 2000, 'insert', 200), insert('overlay', 2000, 'overlay', 1200), insert('b', 2000, 'pause', 300), insert('gap', 2500, 'pause', 400), insert('tail', 6000, 'insert', 500)];
  input.production.ending = { enabled: true, durationMs: 600, type: 'end', message: '' };
  assert.deepEqual(resolve(input).segments, [
    { type: 'pause', insertId: 'before', outputStartMs: 0, outputEndMs: 100 },
    { type: 'tts', sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 100, outputEndMs: 2100 },
    { type: 'insert', insertId: 'a', outputStartMs: 2100, outputEndMs: 2300 },
    { type: 'pause', insertId: 'b', outputStartMs: 2300, outputEndMs: 2600 },
    { type: 'tts', sourceStartMs: 2000, sourceEndMs: 2500, outputStartMs: 2600, outputEndMs: 3100 },
    { type: 'overlay', insertId: 'overlay', outputStartMs: 2600, outputEndMs: 3800 },
    { type: 'pause', insertId: 'gap', outputStartMs: 3100, outputEndMs: 3500 },
    { type: 'tts', sourceStartMs: 2500, sourceEndMs: 6000, outputStartMs: 3500, outputEndMs: 7000 },
    { type: 'insert', insertId: 'tail', outputStartMs: 7000, outputEndMs: 7500 },
    { type: 'ending', outputStartMs: 7500, outputEndMs: 8100 },
  ]);
});
test('caption before/after anchors use actual cue edges and sparse IDs', () => {
  const input = fixture();
  const a = insert('a', 0), b = insert('b', 0);
  a.anchor = { type: 'caption_after', captionId: 1 };
  b.anchor = { type: 'caption_before', captionId: 3 };
  input.production.inserts = [b, a];
  assert.deepEqual(resolve(input).segments.filter(s => 'insertId' in s).map(s => s.outputStartMs), [2000, 4000]);
});
test('same anchor uses production order, independent of ID and anchor syntax', () => {
  const input = fixture();
  input.source.captions[1]!.startMs = 2000;
  const a = insert('z', 2000), b = insert('a', 0, 'pause');
  b.anchor = { type: 'caption_before', captionId: 3 };
  input.production.inserts = [a, b];
  assert.deepEqual(resolve(input).segments.filter(s => 'insertId' in s).map(s => s.insertId), ['z', 'a']);
});
test('overlays inside cue do not split TTS and same-anchor overlays retain input order', () => {
  const input = fixture();
  input.production.inserts = [insert('z', 700, 'overlay'), insert('a', 700, 'overlay')];
  const t = resolve(input);
  assert.equal(t.durationMs, 6000);
  assert.equal(t.segments.filter(s => s.type === 'tts').length, 1);
  assert.deepEqual(t.segments.flatMap(s => s.type === 'overlay' ? [s.insertId] : []), ['z', 'a']);
});
test('overlay may end exactly at narration boundary but never borrow ending time', () => {
  const input = fixture();
  input.production.inserts = [insert('a', 5000, 'overlay')];
  input.production.ending.enabled = true; input.production.ending.durationMs = 3000;
  assert.equal(resolve(input).durationMs, 9000);
  input.production.inserts[0]!.durationMs++;
  rejects(input, 'TIMELINE_OVERLAY_BOUNDS');
});
test('source-end overlay fails, even with a stop there', () => {
  const input = fixture(); input.production.inserts = [insert('a', 6000), insert('b', 6000, 'overlay')];
  rejects(input, 'TIMELINE_OVERLAY_BOUNDS');
});
for (const mode of ['insert', 'pause', 'overlay'] as const) test(`trim override changes effective ${mode} duration without rewriting input`, () => {
  const input = fixture(); input.production.inserts = [insert('a', 2000, mode)];
  input.overrides.inserts.a = { trim: { startMs: 500, endMs: 2000 } };
  const before = structuredClone(input);
  const t = resolve(input); const op = t.segments.find(s => 'insertId' in s)!;
  assert.equal(op.outputEndMs - op.outputStartMs, 1500);
  assert.equal(t.durationMs, mode === 'overlay' ? 6000 : 7500);
  assert.deepEqual(input, before);
});
test('base trim and effective override bounds use declared asset metadata', () => {
  const input = fixture(); input.production.inserts = [insert('a', 2000)];
  input.production.inserts[0]!.trim = { startMs: 1000, endMs: 2000 };
  input.production.assets.clip01!.durationMs = 2500;
  resolve(input);
  input.overrides.inserts.a = { trim: { startMs: 2000, endMs: 2600 } };
  rejects(input, 'TIMELINE_ASSET_DURATION');
});
const invalidCases: [string, (input: TimelineInput) => void, string][] = [
  ['negative duration', x => { x.source.durationMs = -1; }, 'TIMELINE_INPUT_SCHEMA'],
  ['unsafe integer', x => { x.source.durationMs = Number.MAX_SAFE_INTEGER + 1; }, 'TIMELINE_INPUT_SCHEMA'],
  ['reversed trim', x => { x.overrides.inserts.a = { trim: { startMs: 2, endMs: 1 } }; }, 'TIMELINE_INPUT_SCHEMA'],
  ['unknown anchor', x => { x.production.inserts[0]!.anchor = { type: 'caption_after', captionId: 2 }; }, 'TIMELINE_CAPTION_REF'],
  ['outside source', x => { x.production.inserts[0]!.anchor = { type: 'source_time', timeMs: 6001 }; }, 'TIMELINE_ANCHOR_TIME'],
  ['cue interior', x => { x.production.inserts[0]!.anchor = { type: 'source_time', timeMs: 1000 }; }, 'TIMELINE_ANCHOR_TIME'],
  ['unknown asset prototype key', x => { x.production.inserts[0]!.assetId = 'constructor'; }, 'TIMELINE_ASSET_REF'],
  ['duplicate insert', x => { x.production.inserts.push(structuredClone(x.production.inserts[0]!)); }, 'TIMELINE_DUPLICATE_ID'],
  ['unknown override', x => { x.overrides.inserts.unknown = { trim: { startMs: 0, endMs: 1 } }; }, 'TIMELINE_INSERT_REF'],
  ['mismatched project', x => { x.overrides.projectId = 'other'; }, 'TIMELINE_PROJECT_REF'],
  ['zero ending', x => { x.production.ending.enabled = true; }, 'TIMELINE_ENDING_DURATION'],
  ['scene outputTiming', x => { x.overrides.scenes.scene_001 = { outputTiming: { startMs: 0, endMs: 2000 } }; }, 'TIMELINE_UNSUPPORTED_OUTPUT_TIMING'],
  ['unknown scene', x => { x.overrides.scenes.nope = {}; }, 'TIMELINE_SCENE_REF'],
  ['invalid caption order', x => { x.source.captions.reverse(); }, 'CAPTION_ID_ORDER'],
  ['blank caption', x => { x.source.captions[0]!.text = ' '; }, 'CAPTION_EMPTY_TEXT'],
  ['asset type mismatch', x => { x.production.inserts[0]!.type = 'DRAMA_CLIP'; }, 'TIMELINE_ASSET_TYPE'],
];
for (const [name, change, code] of invalidCases) test(`rejects ${name} without a partial timeline`, () => {
  const input = fixture(); input.production.inserts = [insert('a', 2000)]; change(input);
  const snapshot = structuredClone(input); rejects(input, code); assert.deepEqual(input, snapshot);
});
test('reports deferred visual/global overrides and permits placeholder assets', () => {
  const input = fixture(); input.overrides.global.captionOffsetY = 30;
  input.overrides.scenes.scene_001 = { captionMode: 'hidden' };
  input.production.inserts = [insert('a', 2000)];
  const result = resolveTimeline(input); assert.equal(result.valid, true);
  assert.equal(result.diagnostics.filter(d => d.code === 'TIMELINE_DEFERRED_OVERRIDE').length, 2);
});
test('empty captions with explicit duration preserve source and warn', () => {
  const input = fixture(); input.source.captions = []; input.production.scenes = [];
  assert.equal(resolve(input).durationMs, 6000);
  assert.ok(resolveTimeline(input).diagnostics.some(d => d.code === 'CAPTION_EMPTY'));
});
test('safe integer ceiling succeeds exactly and fails accumulated overflow', () => {
  const input = fixture(); input.source.durationMs = Number.MAX_SAFE_INTEGER - 1000;
  input.production.inserts = [insert('a', 2000)];
  assert.equal(resolve(input).durationMs, Number.MAX_SAFE_INTEGER);
  input.production.ending.enabled = true; input.production.ending.durationMs = 1;
  rejects(input, 'TIMELINE_DURATION_OVERFLOW');
});
test('overlay endpoint overflow is a structured failure', () => {
  const input = fixture(); input.source.durationMs = Number.MAX_SAFE_INTEGER;
  input.production.inserts = [insert('a', Number.MAX_SAFE_INTEGER - 10, 'overlay', 100)];
  rejects(input, 'TIMELINE_DURATION_OVERFLOW');
});
test('deep-frozen input resolves repeatedly without mutation or aliases', () => {
  const input = fixture(); input.production.inserts = [insert('a', 2000)];
  function freeze(value: unknown) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(input); const a = resolve(input), b = resolve(input); assert.deepEqual(a, b);
  a.segments[0]!.outputEndMs = 1; assert.deepEqual(resolve(input), b);
});
test('parser integration preserves explicit trailing silence and original source text', () => {
  const input = fixture(); const raw = '1\r\n00:00:00,500 --> 00:00:02,000\r\n 日本語 \r\n';
  const parsed = parseSrt(raw, { durationMs: 6000 }); assert.ok(parsed.source);
  input.source = parsed.source; input.production.scenes[0]!.captionRange.end = 1;
  assert.equal(resolve(input).durationMs, 6000); assert.equal(parsed.originalSrt, raw);
  assert.equal(parsed.source.captions[0]!.text, ' 日本語 ');
});

function validationFixture() {
  const input = fixture(); input.production.inserts = [insert('a', 2000), insert('o', 1000, 'overlay', 500)];
  input.production.ending.enabled = true; input.production.ending.durationMs = 500;
  return { input, timeline: resolve(input) };
}
const corruptions: [string, (timeline: ResolvedTimeline) => void, string][] = [
  ['source gap', t => { const s = t.segments.find(s => s.type === 'tts')!; if (s.type === 'tts') { s.sourceStartMs++; s.outputStartMs++; } }, 'TIMELINE_SOURCE_COVERAGE'],
  ['source duplication', t => { const s = t.segments.filter(s => s.type === 'tts')[1]!; s.sourceStartMs = 0; s.sourceEndMs = 4000; }, 'TIMELINE_SOURCE_COVERAGE'],
  ['output gap', t => { const s = t.segments.find(s => s.type === 'insert')!; s.outputStartMs++; }, 'TIMELINE_OUTPUT_CONTINUITY'],
  ['missing insert', t => { t.segments = t.segments.filter(s => s.type !== 'insert'); }, 'TIMELINE_INSERT_MISSING'],
  ['missing overlay', t => { t.segments = t.segments.filter(s => s.type !== 'overlay'); }, 'TIMELINE_INSERT_MISSING'],
  ['duplicate overlay', t => { const s = t.segments.find(s => s.type === 'overlay')!; t.segments.splice(2, 0, { ...s }); }, 'TIMELINE_INSERT_DUPLICATE'],
  ['wrong insert ref', t => { const s = t.segments.find(s => s.type === 'insert')!; if ('insertId' in s) s.insertId = 'other'; }, 'TIMELINE_INSERT_REF'],
  ['wrong overlay anchor', t => { const s = t.segments.find(s => s.type === 'overlay')!; s.outputStartMs++; s.outputEndMs++; }, 'TIMELINE_INSERT_TIMING'],
  ['wrong effective length', t => { t.segments.find(s => s.type === 'insert')!.outputEndMs--; }, 'TIMELINE_INSERT_TIMING'],
  ['wrong mode', t => { const s = t.segments.find(s => s.type === 'insert')!; s.type = 'overlay'; }, 'TIMELINE_INSERT_TIMING'],
  ['missing ending', t => { t.segments = t.segments.filter(s => s.type !== 'ending'); }, 'TIMELINE_ENDING'],
  ['duplicate ending', t => { t.segments.push({ ...t.segments.at(-1)! }); }, 'TIMELINE_ENDING'],
  ['total duration', t => { t.durationMs++; }, 'TIMELINE_DURATION'],
  ['production revision', t => { t.productionRevision++; }, 'TIMELINE_REVISION'],
  ['override revision', t => { t.overridesRevision++; }, 'TIMELINE_REVISION'],
  ['project identity', t => { t.projectId = 'other'; }, 'TIMELINE_PROJECT_REF'],
  ['out of order', t => { t.segments.reverse(); }, 'TIMELINE_SEGMENT_ORDER'],
  ['out of bounds overlay', t => { t.segments.find(s => s.type === 'overlay')!.outputEndMs = t.durationMs + 1; }, 'TIMELINE_OUTPUT_SCHEMA'],
];
for (const [name, change, code] of corruptions) test(`deep validator detects ${name}`, () => {
  const { input, timeline } = validationFixture(); change(timeline);
  const before = structuredClone(timeline); const result = validateResolvedTimeline(input, timeline);
  assert.equal(result.valid, false); assert.ok(result.diagnostics.some(d => d.code === code), JSON.stringify(result.diagnostics));
  assert.deepEqual(timeline, before);
});
test('validator permits further TTS partitioning when mapping is preserved', () => {
  const input = fixture(); const timeline = resolve(input);
  timeline.segments = [
    { type: 'tts', sourceStartMs: 0, sourceEndMs: 1000, outputStartMs: 0, outputEndMs: 1000 },
    { type: 'tts', sourceStartMs: 1000, sourceEndMs: 6000, outputStartMs: 1000, outputEndMs: 6000 },
  ];
  assert.equal(validateResolvedTimeline(input, timeline).valid, true);
});
test('validator rejects invalid input before considering output', () => {
  assert.equal(validateResolvedTimeline(null, null).valid, false);
});
test('validator rejects continuous TTS that crosses a required stop', () => {
  const input = fixture(); input.production.inserts = [insert('a', 2000)];
  const timeline = resolve(input);
  timeline.segments = [{ type: 'tts', sourceStartMs: 0, sourceEndMs: 6000, outputStartMs: 0, outputEndMs: 6000 }];
  const result = validateResolvedTimeline(input, timeline);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(d => d.code === 'TIMELINE_TTS_MAPPING'));
});
test('disabled ending duration is excluded and injected ending is rejected', () => {
  const input = fixture(); input.production.ending.durationMs = 1000;
  const timeline = resolve(input); assert.equal(timeline.durationMs, 6000);
  timeline.durationMs = 7000;
  timeline.segments.push({ type: 'ending', outputStartMs: 6000, outputEndMs: 7000 });
  assert.ok(validateResolvedTimeline(input, timeline).diagnostics.some(d => d.code === 'TIMELINE_ENDING'));
});
test('shorter override shifts subsequent stops and overlay by effective duration', () => {
  const input = fixture(); input.production.inserts = [insert('a', 2000), insert('b', 3000), insert('c', 3200, 'overlay', 100)];
  input.overrides.inserts.a = { trim: { startMs: 100, endMs: 350 } };
  const timeline = resolve(input);
  assert.deepEqual(timeline.segments.filter(s => 'insertId' in s).map(s => [s.insertId, s.outputStartMs, s.outputEndMs]), [
    ['a', 2000, 2250], ['b', 3250, 4250], ['c', 4450, 4550],
  ]);
  assert.equal(timeline.durationMs, 7250);
});
test('own registered prototype-named asset and insert are valid', () => {
  const id: string = 'constructor';
  const input = fixture(); input.production.assets[id] = { type: 'video', status: 'missing' };
  const op = insert('constructor', 2000); op.assetId = 'constructor'; input.production.inserts = [op];
  input.overrides.inserts[id] = { trim: { startMs: 0, endMs: 500 } };
  assert.equal(resolve(input).durationMs, 6500);
});
