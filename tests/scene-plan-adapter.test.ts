import test from 'node:test';
import assert from 'node:assert/strict';
import { planScenes } from '../src/auto-planner.js';
import { applyReviewedScenePlan } from '../src/scene-plan-adapter.js';
import { resolveTimeline } from '../src/timeline.js';
import { exampleWorkspace } from './fixtures.js';

function fixture() {
  const { production, source, overrides } = exampleWorkspace().projects[0]!;
  const input = { production, source, overrides };
  const planned = planScenes({ source });
  assert.equal(planned.valid, true);
  const handoff = {
    version: 1,
    reviewedAt: '2026-09-20T12:00:00.000Z',
    scenes: planned.scenes!,
    diagnostics: planned.diagnostics,
  };
  return { input, handoff };
}

function hasCode(result: ReturnType<typeof applyReviewedScenePlan>, code: string) {
  assert.equal(result.valid, false);
  assert.equal(result.input, null);
  assert.ok(result.diagnostics.some(item => item.code === code), JSON.stringify(result.diagnostics));
}

test('reviewed handoff replaces only Scenes in a detached TimelineInput snapshot', () => {
  const { input, handoff } = fixture();
  const beforeInput = structuredClone(input), beforeHandoff = structuredClone(handoff);
  input.production.project.status = 'approved';
  const result = applyReviewedScenePlan(input, handoff);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.input.production.scenes, handoff.scenes);
  assert.deepEqual({ ...result.input.production, scenes: beforeInput.production.scenes, project: beforeInput.production.project }, beforeInput.production);
  assert.deepEqual(result.input.source, beforeInput.source);
  assert.deepEqual(result.input.overrides, beforeInput.overrides);
  assert.equal(result.input.production.project.status, 'approved');
  assert.equal(result.input.production.project.revision, beforeInput.production.project.revision);
  assert.equal(resolveTimeline(result.input).valid, true);
  assert.deepEqual(handoff, beforeHandoff);
  assert.deepEqual(input.production.scenes, beforeInput.production.scenes);
  result.input.production.scenes[0]!.content.mainText = 'edited result';
  input.source.captions[0]!.text = 'edited caller';
  assert.notEqual(handoff.scenes[0]!.content.mainText, 'edited result');
  assert.notEqual(result.input.source.captions[0]!.text, 'edited caller');
});

test('strict handoff accepts only version 1 and rejects extra or malformed fields', () => {
  const { input, handoff } = fixture();
  for (const change of [
    { ...handoff, version: 2 },
    { ...handoff, reviewedAt: 'yesterday' },
    { ...handoff, extra: true },
    { ...handoff, scenes: [{ ...handoff.scenes[0], invented: true }] },
    { ...handoff, diagnostics: [{ severity: 'warning', code: 'X', path: '', message: 'x', extra: true }] },
  ]) hasCode(applyReviewedScenePlan(input, change), 'SCENE_PLAN_HANDOFF_SCHEMA');
});

test('error diagnostics and empty handoff fail without a partial input', () => {
  const { input, handoff } = fixture();
  hasCode(applyReviewedScenePlan(input, { ...handoff, diagnostics: [{ severity: 'error', code: 'PLANNER_BAD', path: 'scenes', message: 'bad' }] }), 'SCENE_PLAN_REVIEW_ERRORS');
  hasCode(applyReviewedScenePlan(input, { ...handoff, scenes: [] }), 'SCENE_PLAN_EMPTY');
});

test('existing input and SourceTimeline must be valid before replacement', () => {
  const { input, handoff } = fixture();
  hasCode(applyReviewedScenePlan({ ...input, unknown: true }, handoff), 'SCENE_PLAN_INPUT_SCHEMA');
  const badSource = structuredClone(input);
  badSource.source.captions[1]!.startMs = badSource.source.captions[0]!.startMs;
  hasCode(applyReviewedScenePlan(badSource, handoff), 'CAPTION_OVERLAP');
  const badExisting = structuredClone(input);
  badExisting.production.scenes[0]!.captionRange.end = 999;
  hasCode(applyReviewedScenePlan(badExisting, handoff), 'TIMELINE_CAPTION_REF');
});

test('sparse source caption IDs are accepted while unknown endpoints and overlaps fail', () => {
  const { input, handoff } = fixture();
  input.source.captions[0]!.id = 2;
  input.source.captions[1]!.id = 9;
  input.production.scenes[0]!.captionRange = { start: 2, end: 9 };
  input.production.inserts[0]!.anchor = { type: 'caption_after', captionId: 2 };
  handoff.scenes[0]!.captionRange = { start: 2, end: 2 };
  handoff.scenes[1]!.captionRange = { start: 9, end: 9 };
  assert.equal(applyReviewedScenePlan(input, handoff).valid, true);
  const unknown = structuredClone(handoff);
  unknown.scenes[1]!.captionRange.start = 8;
  unknown.scenes[1]!.captionRange.end = 8;
  hasCode(applyReviewedScenePlan(input, unknown), 'SCENE_PLAN_CAPTION_REF');
  const overlap = structuredClone(handoff);
  overlap.scenes[0]!.captionRange.end = 9;
  hasCode(applyReviewedScenePlan(input, overlap), 'SCENE_PLAN_OVERLAP');
});

test('duplicate Scene IDs and surviving override references fail atomically', () => {
  const { input, handoff } = fixture();
  const duplicate = structuredClone(handoff);
  duplicate.scenes[1]!.id = duplicate.scenes[0]!.id;
  hasCode(applyReviewedScenePlan(input, duplicate), 'SCENE_PLAN_DUPLICATE_ID');
  input.overrides.scenes.scene_001 = { captionMode: 'subtle' };
  const changed = structuredClone(handoff);
  changed.scenes[0]!.id = 'reviewed_new';
  hasCode(applyReviewedScenePlan(input, changed), 'TIMELINE_SCENE_REF');
});

test('frozen caller data can be applied without mutation', () => {
  const { input, handoff } = fixture();
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(input); freeze(handoff);
  assert.equal(applyReviewedScenePlan(input, handoff).valid, true);
});
