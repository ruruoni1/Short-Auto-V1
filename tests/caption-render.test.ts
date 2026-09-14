import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaptionRenderFixture } from '../src/render/fixture/caption-data.js';
import { makeRenderFixture } from '../src/render/fixture/data.js';
import { prepareScenePreview, SceneRenderError, selectCaptionDisplay } from '../src/render/plan.js';

test('caption display policy is optional and omission preserves the cue-level plan', () => {
  const fixture = makeCaptionRenderFixture();
  const before = structuredClone(fixture);
  const plan = prepareScenePreview(fixture.input, fixture.pack);
  assert.equal(plan.captionDisplayUnits, null);
  assert.deepEqual(fixture, before);
});

test('display units keep sparse source IDs and original caption indexes', () => {
  const fixture = makeCaptionRenderFixture();
  const before = structuredClone(fixture);
  const plan = prepareScenePreview(fixture.input, fixture.pack, fixture.captionDisplayPolicy);
  assert.ok(plan.captionDisplayUnits);
  assert.deepEqual([...new Set(plan.captionDisplayUnits.map(unit => unit.sourceCaptionId))], [1, 8, 15, 22]);
  assert.deepEqual([...new Set(plan.captionDisplayUnits.map(unit => unit.sourceCaptionIndex))], [0, 1, 2, 3]);
  assert.ok(plan.captionDisplayUnits.every(unit => unit.lines.length <= fixture.captionDisplayPolicy.maxLinesPerUnit));
  assert.deepEqual(fixture, before);
});

test('selection uses half-open Source time and stops hide captions before exact resume', () => {
  const fixture = makeCaptionRenderFixture();
  const plan = prepareScenePreview(fixture.input, fixture.pack, fixture.captionDisplayPolicy);
  const units = plan.captionDisplayUnits!;
  const first = units[0]!;
  assert.equal(selectCaptionDisplay(plan.runtime.getState(first.startMs), units)?.origin, 'source');
  const next = units.find(unit => unit.sourceCaptionId === first.sourceCaptionId && unit.unitIndex === first.unitIndex + 1)!;
  assert.equal(selectCaptionDisplay(plan.runtime.getState(first.endMs), units)?.origin, 'source');
  assert.equal((selectCaptionDisplay(plan.runtime.getState(first.endMs), units) as { unit: { unitIndex: number } }).unit.unitIndex, next.unitIndex);
  assert.equal(selectCaptionDisplay(plan.runtime.getState(6000), units), null);
  assert.equal(selectCaptionDisplay(plan.runtime.getState(6499), units), null);
  assert.equal(selectCaptionDisplay(plan.runtime.getState(6500), units), null);
  assert.equal(selectCaptionDisplay(plan.runtime.getState(6999), units), null);
  const resumed = selectCaptionDisplay(plan.runtime.getState(7000), units);
  assert.equal(resumed?.origin, 'source');
  assert.equal(resumed?.origin === 'source' ? resumed.unit.sourceCaptionId : -1, 15);
});

test('explicit override lines win without source offsets and an empty array stays empty', () => {
  const fixture = makeCaptionRenderFixture();
  const plan = prepareScenePreview(fixture.input, fixture.pack, fixture.captionDisplayPolicy);
  const direct = selectCaptionDisplay(plan.runtime.getState(13000), plan.captionDisplayUnits!);
  assert.deepEqual(direct, { origin: 'override', sceneId: 'long4', lines: ['직접 지정한 첫 줄', '원문 범위와 별개예요'] });
  assert.equal('unit' in direct!, false);
  assert.deepEqual(selectCaptionDisplay(plan.runtime.getState(16000), plan.captionDisplayUnits!), { origin: 'override', sceneId: 'long5', lines: [] });
});

test('hidden scene captions remain hidden with display units', () => {
  const fixture = makeCaptionRenderFixture();
  fixture.input.production.scenes[0]!.captionMode = 'hidden';
  const plan = prepareScenePreview(fixture.input, fixture.pack, fixture.captionDisplayPolicy);
  assert.equal(selectCaptionDisplay(plan.runtime.getState(500), plan.captionDisplayUnits!), null);
});

test('fully overridden cues skip source splitting while ordinary short cues fail explicitly', () => {
  const overridden = makeCaptionRenderFixture();
  for (const scene of overridden.input.production.scenes) overridden.input.overrides.scenes[scene.id] = { caption: { lines: [] } };
  const policy = { maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: 300 };
  assert.deepEqual(prepareScenePreview(overridden.input, overridden.pack, policy).captionDisplayUnits, []);
  const ordinary = makeCaptionRenderFixture();
  assert.throws(() => prepareScenePreview(ordinary.input, ordinary.pack, policy), error =>
    error instanceof SceneRenderError && error.diagnostics.some(diagnostic => diagnostic.code === 'CAPTION_DISPLAY_TOO_SHORT'));
});

test('units too short to occupy an output frame fail with a renderer diagnostic', () => {
  const fixture = makeRenderFixture();
  const policy = { maxGraphemesPerLine: 1, maxLinesPerUnit: 1, minUnitDurationMs: 1 };
  assert.throws(() => prepareScenePreview(fixture.input, fixture.pack, policy), error =>
    error instanceof SceneRenderError && error.diagnostics.some(diagnostic => diagnostic.code === 'RENDER_CAPTION_UNIT_UNCAPTURED'));
});

test('selected caption text remains a React text child', () => {
  const fixture = makeCaptionRenderFixture();
  const plan = prepareScenePreview(fixture.input, fixture.pack, fixture.captionDisplayPolicy);
  const lines = plan.captionDisplayUnits!.filter(unit => unit.sourceCaptionId === 22).flatMap(unit => unit.lines.map(line => line.text));
  const html = renderToStaticMarkup(createElement('div', null, lines.map((line, index) => createElement('span', { key: index }, line))));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(!html.includes('<b>text</b>'));
});
