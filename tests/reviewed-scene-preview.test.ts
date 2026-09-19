import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRenderFixture } from '../src/render/fixture/data.js';
import { prepareReviewedScenePreview, prepareScenePreview, SceneRenderError } from '../src/render/index.js';

function fixture() {
  const { input, pack } = makeRenderFixture();
  const handoff = {
    version: 1,
    reviewedAt: '2026-09-20T12:00:00.000Z',
    scenes: structuredClone(input.production.scenes),
    diagnostics: [],
  };
  handoff.scenes[0]!.content.mainText = '검토 완료 장면';
  return { input, handoff, pack };
}

test('reviewed Scene handoff reaches the existing Preview plan without changing callers', () => {
  const { input, handoff, pack } = fixture();
  const originalInput = structuredClone(input), originalHandoff = structuredClone(handoff);
  const plan = prepareReviewedScenePreview(input, handoff, pack);
  assert.equal(plan.runtime.scenes[0]!.scene.content.mainText, '검토 완료 장면');
  assert.deepEqual(plan.input.production.scenes, handoff.scenes);
  assert.deepEqual(plan.input.source, originalInput.source);
  assert.deepEqual(plan.input.overrides, originalInput.overrides);
  assert.equal(plan.input.production.project.status, originalInput.production.project.status);
  assert.equal(plan.input.production.project.revision, originalInput.production.project.revision);
  assert.deepEqual(plan.timeline, prepareScenePreview(plan.input, pack).timeline);
  assert.deepEqual(input, originalInput);
  assert.deepEqual(handoff, originalHandoff);
  assert.notEqual(prepareScenePreview(input, pack).runtime.scenes[0]!.scene.content.mainText, '검토 완료 장면');
});

test('optional Caption display policy is passed to the existing Preview compiler', () => {
  const { input, handoff, pack } = fixture();
  const policy = { maxGraphemesPerLine: 50, maxLinesPerUnit: 2, minUnitDurationMs: 100 };
  const plan = prepareReviewedScenePreview(input, handoff, pack, policy);
  assert.ok(plan.captionDisplayUnits);
  assert.ok(plan.captionDisplayUnits.length > 0);
  assert.equal(prepareReviewedScenePreview(input, handoff, pack).captionDisplayUnits, null);
});

test('invalid handoff fails with adapter diagnostics and no Preview plan', () => {
  const { input, handoff, pack } = fixture();
  const before = structuredClone(input);
  const invalid = { ...handoff, scenes: [] };
  assert.throws(() => prepareReviewedScenePreview(input, invalid, pack), error =>
    error instanceof SceneRenderError && error.diagnostics.some(item => item.code === 'SCENE_PLAN_EMPTY'));
  assert.deepEqual(input, before);
});

test('renderer unsupported Scene remains a renderer error after valid handoff', () => {
  const { input, handoff, pack } = fixture();
  handoff.scenes[0]!.motion = { preset: 'FREEZE_FOCUS', intensity: 'normal' };
  assert.throws(() => prepareReviewedScenePreview(input, handoff, pack), error =>
    error instanceof SceneRenderError && error.diagnostics.some(item => item.code.includes('FREEZE_FOCUS')));
});

test('frozen input and handoff remain unchanged', () => {
  const { input, handoff, pack } = fixture();
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(input);
  freeze(handoff);
  assert.equal(prepareReviewedScenePreview(input, handoff, pack).runtime.scenes.length, handoff.scenes.length);
});
