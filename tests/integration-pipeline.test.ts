import test from 'node:test';
import assert from 'node:assert/strict';
import { planScenes } from '../src/auto-planner.js';
import { applyReviewedScenePlan } from '../src/scene-plan-adapter.js';
import { SceneRenderError, prepareReviewedScenePreview } from '../src/render/index.js';
import { makeCaptionRenderFixture } from '../src/render/fixture/caption-data.js';

test('planner to reviewed handoff to preview preserves source and scene identity', () => {
  const fixture = makeCaptionRenderFixture();
  const source = structuredClone(fixture.input.source);
  const planned = planScenes({ source });
  assert.equal(planned.valid, true, JSON.stringify(planned.diagnostics));
  assert.ok(planned.scenes);
  assert.equal(planned.scenes.length, source.captions.length);

  const handoff = {
    version: 1 as const,
    reviewedAt: '2026-09-20T12:00:00.000Z',
    scenes: structuredClone(planned.scenes),
    diagnostics: structuredClone(planned.diagnostics),
  };

  // Keep the existing render fixture's assets, inserts, and caption policy while
  // giving its TimelineInput the planner's source and scene identities.
  const input = structuredClone(fixture.input);
  input.source = source;
  const fixtureSceneIds = input.production.scenes.map(scene => scene.id);
  input.production.scenes = input.production.scenes.map((scene, index) => ({
    ...scene,
    id: handoff.scenes[index]!.id,
    captionRange: handoff.scenes[index]!.captionRange,
  }));
  input.overrides.scenes = Object.fromEntries(
    Object.entries(input.overrides.scenes).map(([id, value]) => {
      const index = fixtureSceneIds.indexOf(id);
      return [index < 0 ? id : handoff.scenes[index]!.id, value];
    }),
  );

  const originalProject = structuredClone(input.production.project);
  const applied = applyReviewedScenePlan(input, handoff);
  assert.equal(applied.valid, true, JSON.stringify(applied.diagnostics));
  if (!applied.valid) return;
  assert.deepEqual(applied.input.source, source);
  assert.deepEqual(applied.input.production.scenes.map(scene => scene.id), handoff.scenes.map(scene => scene.id));
  assert.deepEqual(applied.input.production.project, originalProject);
  assert.equal(applied.input.production.project.status, 'draft');
  assert.equal(applied.input.production.project.revision, 0);

  const preview = prepareReviewedScenePreview(input, handoff, fixture.pack, fixture.captionDisplayPolicy);
  assert.ok(preview.runtime.scenes.length > 0);
  assert.ok(preview.captionDisplayUnits && preview.captionDisplayUnits.length > 0);
  assert.deepEqual(preview.input.source, source);
  assert.deepEqual(preview.runtime.scenes.map(scene => scene.scene.id), handoff.scenes.map(scene => scene.id));
  assert.deepEqual(preview.input.production.project, originalProject);
  assert.equal(preview.input.production.project.status, 'draft');
  assert.equal(preview.input.production.project.revision, 0);
  assert.equal(Object.hasOwn(preview.input.production.project, 'publishedAt'), false);

  const beforeInvalid = structuredClone(input);
  const unreviewed = {
    ...handoff,
    diagnostics: [...handoff.diagnostics, { severity: 'error' as const, code: 'UNREVIEWED', path: 'scenes', message: 'Review is required' }],
  };
  assert.throws(() => prepareReviewedScenePreview(input, unreviewed, fixture.pack, fixture.captionDisplayPolicy), error =>
    error instanceof SceneRenderError && error.diagnostics.some(item => item.code === 'SCENE_PLAN_REVIEW_ERRORS'));
  assert.deepEqual(input, beforeInvalid);

  const invalid = { ...handoff, reviewedAt: 'not-reviewed' };
  assert.throws(() => prepareReviewedScenePreview(input, invalid, fixture.pack, fixture.captionDisplayPolicy), error =>
    error instanceof SceneRenderError && error.diagnostics.some(item => item.code === 'SCENE_PLAN_HANDOFF_SCHEMA'));
  assert.deepEqual(input, beforeInvalid);
});
