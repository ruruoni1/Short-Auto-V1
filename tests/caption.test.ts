import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, validateCaptions, SourceTimelineSchema, validateWorkspace } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

const srt = (id = '1', start = '00:00:00,000', end = '00:00:01,000', text = '안녕하세요\nこんにちは') => `${id}\n${start} --> ${end}\n${text}`;
const hasCode = (result: { diagnostics: { code: string }[] }, code: string) => assert.ok(result.diagnostics.some(d => d.code === code), JSON.stringify(result));

for (const eol of ['\n', '\r\n']) for (const bom of ['', '\uFEFF']) {
  test(`preserves Korean/Japanese, spacing, tags, BOM=${!!bom}, EOL=${JSON.stringify(eol)}`, () => {
    const body = '  한국어  \n<i>日本語</i>\n독음입니다 ';
    const input = bom + (srt('0003', undefined, undefined, body) + '\n\n' + srt('7', '00:00:01,000', '00:00:02,123') + '\n\n').replaceAll('\n', eol);
    const result = parseSrt(input, { durationMs: 3000 });
    assert.equal(result.valid, true);
    assert.equal(result.originalSrt, input);
    assert.equal(result.source!.captions[0]!.text, body.replaceAll('\n', eol));
    assert.deepEqual(result.source!.captions.map(c => c.id), [3, 7]);
    assert.equal(result.source!.captions[1]!.endMs, 2123);
    assert.deepEqual(result.duration, { kind: 'provided', durationMs: 3000 });
    assert.equal(result.cues.length, 2);
    for (const cue of result.cues) assert.equal(cue.raw, input.slice(cue.startOffset, cue.endOffset));
    assert.ok(SourceTimelineSchema.safeParse(result.source).success);
    assert.equal(result.cues[1]!.line, 7);
  });
}

test('inference is explicitly last cue end, not audio length', () => {
  const r = parseSrt(srt());
  assert.equal(r.valid, true);
  assert.deepEqual(r.duration, { kind: 'inferred-last-cue', durationMs: 1000 });
  hasCode(r, 'SRT_DURATION_INFERRED');
});
test('provided duration preserves trailing silence and does not emit inference warning', () => {
  const r = parseSrt(srt(), { durationMs: 5500 });
  assert.equal(r.source!.durationMs, 5500);
  assert.equal(r.diagnostics.length, 0);
});
test('mixed LF/CRLF, leading/trailing blank lines and no final newline', () => {
  const input = '\uFEFF\r\n \n' + srt().replace('\n', '\r\n');
  const r = parseSrt(input);
  assert.equal(r.valid, true);
  assert.equal(r.cues[0]!.line, 3);
  assert.equal(r.cues[0]!.text, '안녕하세요\nこんにちは');
});
test('hours over 99 and zero-padded IDs preserve numeric identity', () => {
  const r = parseSrt(srt('0009', '100:00:00,001', '100:00:01,234'));
  assert.equal(r.source!.captions[0]!.id, 9);
  assert.equal(r.source!.captions[0]!.startMs, 360000001);
});

const syntaxCases: [string, string, string][] = [
  ['empty', '', 'SRT_EMPTY'], ['blank BOM', '\uFEFF\r\n \n\t', 'SRT_EMPTY'],
  ['zero ID', srt('0'), 'SRT_NUMBER'], ['negative ID', srt('-1'), 'SRT_NUMBER'],
  ['fractional ID', srt('1.5'), 'SRT_NUMBER'], ['text ID', srt('one'), 'SRT_NUMBER'],
  ['unsafe ID', srt('9007199254740992'), 'SRT_NUMBER'],
  ['missing number', '00:00:00,000 --> 00:00:01,000\ntext', 'SRT_NUMBER'],
  ['missing time', '1', 'SRT_TIME_FORMAT'],
  ['seconds overflow', srt('1', '00:00:60,000'), 'SRT_TIME_FORMAT'],
  ['minutes overflow', srt('1', '00:60:00,000'), 'SRT_TIME_FORMAT'],
  ['decimal dot', srt('1', '00:00:00.000'), 'SRT_TIME_FORMAT'],
  ['negative time', srt('1', '-00:00:01,000'), 'SRT_TIME_FORMAT'],
  ['unsafe time', srt('1', '999999999999:00:00,000'), 'SRT_TIME_RANGE'],
  ['equal time', srt('1', '00:00:01,000'), 'SRT_TIME_INTERVAL'],
  ['reverse interval', srt('1', '00:00:02,000'), 'SRT_TIME_INTERVAL'],
  ['no text', '1\n00:00:00,000 --> 00:00:01,000', 'SRT_EMPTY_TEXT'],
  ['whitespace text', srt('1', undefined, undefined, '  \t'), 'SRT_EMPTY_TEXT'],
  ['bare CR', srt().replaceAll('\n', '\r'), 'SRT_LINE_ENDING'],
  ['missing separator', srt() + '\n' + srt('2'), 'SRT_MISSING_SEPARATOR'],
  ['timestamp settings', '1\n00:00:00,000 --> 00:00:01,000 position:50%\ntext', 'SRT_TIME_FORMAT'],
];
for (const [name, input, code] of syntaxCases) test(`SRT rejects ${name} without rewriting input`, () => {
  const r = parseSrt(input);
  assert.equal(r.valid, false);
  assert.equal(r.source, null);
  assert.equal(r.originalSrt, input);
  hasCode(r, code);
});

test('invalid middle block retained with original line/index, later cues not renumbered', () => {
  const r = parseSrt(srt('1') + '\n\n' + srt('bad') + '\n\n' + srt('9', '00:00:02,000', '00:00:03,000'));
  assert.equal(r.cues.length, 3);
  assert.equal(r.cues[1]!.caption, null);
  assert.equal(r.cues[2]!.caption!.id, 9);
  const issue = r.diagnostics.find(d => d.code === 'SRT_NUMBER')!;
  assert.equal(issue.cueIndex, 1);
  assert.equal(issue.line, 6);
  assert.deepEqual(r.duration, { kind: 'unavailable', durationMs: null });
});
for (const durationMs of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid provided duration ${durationMs}`, () => {
  const r = parseSrt(srt(), { durationMs });
  assert.equal(r.valid, false); assert.equal(r.source, null); hasCode(r, 'SRT_DURATION');
  assert.equal(r.duration.kind, 'unavailable');
});

test('duplicate IDs and decreasing IDs get distinct diagnostics', () => {
  const duplicate = parseSrt(srt('5') + '\n\n' + srt('5', '00:00:01,000', '00:00:02,000'));
  hasCode(duplicate, 'CAPTION_DUPLICATE_ID'); hasCode(duplicate, 'CAPTION_ID_ORDER');
  assert.equal(duplicate.source, null);
  const reversed = parseSrt(srt('5') + '\n\n' + srt('2', '00:00:01,000', '00:00:02,000'));
  hasCode(reversed, 'CAPTION_ID_ORDER'); assert.equal(reversed.cues[1]!.caption!.id, 2);
});
test('reverse time order remains reversed and inference uses last cue, never maximum end', () => {
  const r = parseSrt(srt('1', '00:00:02,000', '00:00:03,000') + '\n\n' + srt('2'));
  hasCode(r, 'CAPTION_TIME_ORDER'); hasCode(r, 'CAPTION_OUTSIDE_DURATION');
  assert.equal(r.duration.durationMs, 1000); assert.equal(r.source, null);
  assert.equal(r.cues[0]!.caption!.startMs, 2000);
});
test('overlap is an error and reports cue location', () => {
  const r = parseSrt(srt() + '\n\n' + srt('2', '00:00:00,999', '00:00:02,000'));
  const d = r.diagnostics.find(d => d.code === 'CAPTION_OVERLAP')!;
  assert.equal(d.cueIndex, 1); assert.equal(d.line, 6); assert.equal(r.source, null);
});
test('provided duration shorter than cue is never silently extended', () => {
  const r = parseSrt(srt(), { durationMs: 999 });
  hasCode(r, 'CAPTION_OUTSIDE_DURATION'); assert.equal(r.duration.durationMs, 999); assert.equal(r.source, null);
});
test('standalone validator finds nested and reversed overlapping intervals without mutation', () => {
  const input = { durationMs: 10000, captions: [
    { id: 1, startMs: 0, endMs: 10000, text: 'a' },
    { id: 2, startMs: 4000, endMs: 5000, text: 'b' },
    { id: 3, startMs: 2000, endMs: 3000, text: 'c' },
  ] };
  const before = structuredClone(input);
  Object.freeze(input.captions); input.captions.forEach(Object.freeze); Object.freeze(input);
  const r = validateCaptions(input);
  assert.equal(r.diagnostics.filter(d => d.code === 'CAPTION_OVERLAP').length, 2);
  hasCode(r, 'CAPTION_TIME_ORDER'); assert.deepEqual(input, before);
});
test('standalone validator handles unknown data and strict Core schema', () => {
  for (const input of [null, [], {}, { durationMs: 0, captions: [] }, { durationMs: 10, captions: [{ id: 0, startMs: 0, endMs: 1, text: 'a' }] }, { durationMs: 10, captions: [], typo: true }]) {
    const r = validateCaptions(input); assert.equal(r.valid, false); hasCode(r, 'CAPTION_SCHEMA');
  }
});
test('standalone empty timeline respects Core schema with explicit warning', () => {
  const r = validateCaptions({ durationMs: 1000, captions: [] });
  assert.equal(r.valid, true); hasCode(r, 'CAPTION_EMPTY');
});
test('standalone whitespace-only caption fails', () => {
  hasCode(validateCaptions({ durationMs: 10, captions: [{ id: 1, startMs: 0, endMs: 10, text: ' \t\r\n' }] }), 'CAPTION_EMPTY_TEXT');
});
test('parser output plugs into existing Core workspace without model changes', () => {
  const workspace = exampleWorkspace();
  const original = workspace.projects[0]!.source;
  const input = original.captions.map(c => srt(String(c.id), `00:00:0${c.startMs / 1000},000`, `00:00:0${c.endMs / 1000},000`, c.text)).join('\n\n');
  const r = parseSrt(input, { durationMs: original.durationMs });
  assert.equal(r.valid, true);
  workspace.projects[0]!.source = r.source!;
  assert.equal(validateWorkspace(workspace).valid, true);
});
