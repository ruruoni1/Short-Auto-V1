import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptionDisplay, parseSrt } from '../src/index.js';
import type { CaptionDisplayPolicy, CaptionDisplayResult, SourceTimeline } from '../src/index.js';

const policy: CaptionDisplayPolicy = { maxGraphemesPerLine: 4, maxLinesPerUnit: 2, minUnitDurationMs: 1 };
const source = (text: string, startMs = 100, endMs = 10100): SourceTimeline => ({ durationMs: endMs + 100, captions: [{ id: 7, startMs, endMs, text }] });
function success(result: CaptionDisplayResult): asserts result is Extract<CaptionDisplayResult, { valid: true }> {
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
}
const hasCode = (r: CaptionDisplayResult, code: string) => assert.ok(r.diagnostics.some(d => d.code === code), JSON.stringify(r));

function verifyPartition(input: SourceTimeline, selectedPolicy = policy) {
  const before = structuredClone(input);
  const r = buildCaptionDisplay(input, selectedPolicy);
  success(r);
  assert.deepEqual(input, before);
  assert.deepEqual(buildCaptionDisplay(input, selectedPolicy), r);
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  input.captions.forEach((cue, cueIndex) => {
    const units = r.units.filter(u => u.sourceCaptionIndex === cueIndex);
    const boundaries = new Set([...segmenter.segment(cue.text)].map(s => s.index));
    boundaries.add(cue.text.length);
    assert.equal(units.map(u => u.text).join(''), cue.text);
    let offset = 0;
    let time = cue.startMs;
    for (const [index, unit] of units.entries()) {
      assert.equal(unit.origin, 'source');
      assert.equal(unit.sourceCaptionId, cue.id);
      assert.equal(unit.unitIndex, index);
      assert.equal(unit.sourceStart, offset);
      assert.ok(unit.sourceEnd > unit.sourceStart);
      assert.equal(unit.text, cue.text.slice(unit.sourceStart, unit.sourceEnd));
      assert.equal(unit.startMs, time);
      assert.ok(unit.endMs - unit.startMs >= selectedPolicy.minUnitDurationMs);
      assert.ok(Number.isSafeInteger(unit.startMs) && Number.isSafeInteger(unit.endMs));
      assert.ok(unit.lines.length <= selectedPolicy.maxLinesPerUnit);
      assert.equal(unit.lines.map(l => l.text + l.lineEnding).join(''), unit.text);
      for (const line of unit.lines) {
        assert.equal(line.sourceStart, offset);
        assert.ok(boundaries.has(line.sourceStart) && boundaries.has(line.sourceEnd));
        assert.equal(cue.text.slice(line.sourceStart, line.sourceEnd), line.text + line.lineEnding);
        assert.equal([...segmenter.segment(line.text)].length, line.graphemeCount);
        assert.ok(line.graphemeCount <= selectedPolicy.maxGraphemesPerLine);
        offset = line.sourceEnd;
      }
      assert.equal(offset, unit.sourceEnd);
      time = unit.endMs;
    }
    assert.equal(offset, cue.text.length);
    assert.equal(time, cue.endMs);
  });
  return r;
}

const texts: [string, string][] = [
  ['Korean', '안녕하세요 오늘은 일본어 공부를 해요.'],
  ['Japanese', '今日は「こんにちは」を練習しましょう。'],
  ['English with a long word', 'Hi supercalifragilisticexpialidocious!'],
  ['mixed languages', '한글 日本語 English 123!'],
  ['combining marks', 'e\u0301a\u0308n\u0303 가\u11a8'],
  ['decomposed Hangul', '\u1100\u1161\u11a8\u1102\u1161'],
  ['emoji ZWJ skin flags variation', '👨‍👩‍👧‍👦👍🏽🇯🇵❤️1️⃣👩🏾‍💻🙂'],
  ['spaces tabs and NBSP', '  가\t 나\u00a0다   '],
  ['LF', '한국어\n日本語\nEnglish'],
  ['CRLF', '한국어\r\n日本語\r\nEnglish'],
  ['mixed line endings', '가\r\n나\n다\r라\u2028마\u2029바'],
  ['leading repeated trailing newlines', '\n\nhello\r\n\r\n끝\n'],
  ['markup treated literally', '<img src=x onerror="alert(1)"> &amp; <script>x</script>'],
  ['one grapheme', '👩🏾‍💻'],
];
for (const [name, text] of texts) test(`lossless ordered partition: ${name}`, () => { verifyPartition(source(text)); });

test('hard wrapping is predictable, including long words and spaces', () => {
  const r = verifyPartition(source('abcde fghi'), { ...policy, maxGraphemesPerLine: 3, maxLinesPerUnit: 2 });
  assert.deepEqual(r.units.map(u => u.lines.map(l => l.text)), [['abc', 'de '], ['fgh', 'i']]);
});
test('emoji and combining sequences count as one and never split', () => {
  const text = '👨‍👩‍👧‍👦e\u0301🇯🇵👍🏽\u1100\u1161\u11a8';
  const r = verifyPartition(source(text), { ...policy, maxGraphemesPerLine: 1, maxLinesPerUnit: 1 });
  assert.deepEqual(r.units.map(u => u.text), ['👨‍👩‍👧‍👦', 'e\u0301', '🇯🇵', '👍🏽', '\u1100\u1161\u11a8']);
});
test('newline at exact width stays with its preceding line; trailing newline adds no page', () => {
  const r = verifyPartition(source('abcd\r\nefgh\n'), { ...policy, maxLinesPerUnit: 1 });
  assert.deepEqual(r.units.map(u => u.text), ['abcd\r\n', 'efgh\n']);
  assert.deepEqual(r.units.map(u => u.lines[0]!.lineEnding), ['\r\n', '\n']);
});
test('blank logical lines preserve their delimiters and consume line slots', () => {
  const r = verifyPartition(source('a\n\n\nb'), { ...policy, maxLinesPerUnit: 1 });
  assert.deepEqual(r.units.map(u => u.text), ['a\n', '\n', '\n', 'b']);
  assert.deepEqual(r.units.map(u => u.lines[0]!.text), ['a', '', '', 'b']);
});
test('integer timing divides equally and gives early units the remainder', () => {
  const r = verifyPartition(source('abc', 100, 110), { ...policy, maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: 3 });
  assert.deepEqual(r.units.map(u => [u.startMs, u.endMs]), [[100, 104], [104, 107], [107, 110]]);
});
test('minimum time exact boundary succeeds; 1ms below fails without partial units', () => {
  const p = { maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: 100 };
  verifyPartition(source('abc', 0, 300), p);
  const r = buildCaptionDisplay(source('abc', 0, 299), p);
  assert.equal(r.valid, false); assert.equal(r.units, null); hasCode(r, 'CAPTION_DISPLAY_TOO_SHORT');
});
test('1ms single-unit cue succeeds; splitting it into two refuses zero length units', () => {
  verifyPartition(source('a', 0, 1));
  const r = buildCaptionDisplay(source('ab', 0, 1), { ...policy, maxGraphemesPerLine: 1, maxLinesPerUnit: 1 });
  hasCode(r, 'CAPTION_DISPLAY_TOO_SHORT'); assert.equal(r.units, null);
});
test('near safe integer boundary timing is exact without intermediate overflow', () => {
  const input: SourceTimeline = { durationMs: Number.MAX_SAFE_INTEGER, captions: [{ id: 1, text: 'abcdefghijk', startMs: 0, endMs: Number.MAX_SAFE_INTEGER }] };
  verifyPartition(input, { maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: 1 });
  const hugeMin = buildCaptionDisplay(input, { maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: Number.MAX_SAFE_INTEGER });
  hasCode(hugeMin, 'CAPTION_DISPLAY_TOO_SHORT');
});
test('source gaps and sparse IDs preserved; no adjacent cue borrowing', () => {
  const input: SourceTimeline = { durationMs: 1000, captions: [
    { id: 3, text: 'abcd', startMs: 10, endMs: 20 },
    { id: 99, text: 'efgh', startMs: 100, endMs: 200 },
  ] };
  verifyPartition(input);
  const r = buildCaptionDisplay(input, { maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: 10 });
  assert.equal(r.units, null); hasCode(r, 'CAPTION_DISPLAY_TOO_SHORT');
});
test('frozen input and policy supported; editing output cannot modify source or later results', () => {
  const input = source('abcdefghijk');
  Object.freeze(input.captions[0]); Object.freeze(input.captions); Object.freeze(input);
  const p = Object.freeze({ ...policy });
  const r = verifyPartition(input, p);
  r.units[0]!.lines[0]!.text = 'changed'; r.policy.maxLinesPerUnit = 99;
  assert.equal(input.captions[0]!.text, 'abcdefghijk'); assert.equal(p.maxLinesPerUnit, 2);
  const next = buildCaptionDisplay(input, p); success(next);
  assert.equal(next.units[0]!.lines[0]!.text, 'abcd');
});
test('empty source captions succeeds with inherited explicit warning', () => {
  const r = buildCaptionDisplay({ durationMs: 1, captions: [] }, policy);
  success(r); assert.deepEqual(r.units, []); hasCode(r, 'CAPTION_EMPTY');
});
for (const text of ['', '  \t', '\r\n\n']) test(`blank cue rejected: ${JSON.stringify(text)}`, () => {
  const r = buildCaptionDisplay(source(text), policy);
  assert.equal(r.valid, false); assert.equal(r.units, null);
  hasCode(r, text ? 'CAPTION_EMPTY_TEXT' : 'CAPTION_SCHEMA');
});
for (const endMs of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid cue time rejected: ${endMs}`, () => {
  const r = buildCaptionDisplay(source('text', 0, endMs), policy);
  assert.equal(r.valid, false); hasCode(r, 'CAPTION_SCHEMA');
});
test('source validation keeps parser/Core semantic checks', () => {
  const input = { durationMs: 10, captions: [
    { id: 3, text: 'a', startMs: 5, endMs: 10 },
    { id: 3, text: 'b', startMs: 0, endMs: 8 },
  ] };
  const r = buildCaptionDisplay(input, policy);
  for (const code of ['CAPTION_DUPLICATE_ID', 'CAPTION_ID_ORDER', 'CAPTION_TIME_ORDER', 'CAPTION_OVERLAP']) hasCode(r, code);
  assert.equal(r.units, null);
});
for (const field of ['maxGraphemesPerLine', 'maxLinesPerUnit', 'minUnitDurationMs'] as const) {
  test(`policy rejects invalid ${field}`, () => {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '2']) {
      const r = buildCaptionDisplay(source('text'), { ...policy, [field]: value } as CaptionDisplayPolicy);
      assert.equal(r.valid, false); assert.equal(r.units, null); hasCode(r, 'CAPTION_DISPLAY_POLICY');
    }
  });
}
test('unknown source and policy fail with diagnostics', () => {
  for (const input of [null, undefined, [], {}, 'srt']) {
    const r = buildCaptionDisplay(input, policy); assert.equal(r.units, null); hasCode(r, 'CAPTION_SCHEMA');
  }
  for (const p of [null, undefined, {}, { ...policy, typo: true }]) {
    const r = buildCaptionDisplay(source('a'), p as CaptionDisplayPolicy); hasCode(r, 'CAPTION_DISPLAY_POLICY');
  }
});
test('parser original SRT, raw cues, ID, text and times survive display generation', () => {
  const parsed = parseSrt('\uFEFF0007\r\n00:00:00,000 --> 00:00:05,001\r\n  日本語👩🏾‍💻\r\n한글 English  \r\n', { durationMs: 6000 });
  assert.ok(parsed.source);
  const before = structuredClone(parsed);
  verifyPartition(parsed.source);
  assert.deepEqual(parsed, before);
});
test('seeded mixed Unicode inputs reconstruct with contiguous grapheme and time boundaries', () => {
  const atoms = ['가', '日', 'a', ' ', '\t', '\r\n', '\n', '👩🏾‍💻', '🇯🇵', 'e\u0301'];
  let seed = 37;
  for (let run = 0; run < 100; run++) {
    let text = 'start';
    for (let i = 0; i < run; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; text += atoms[seed % atoms.length]; }
    verifyPartition(source(text), { maxGraphemesPerLine: run % 7 + 1, maxLinesPerUnit: run % 3 + 1, minUnitDurationMs: 1 });
  }
});
