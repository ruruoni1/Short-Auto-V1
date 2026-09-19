import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceRepository } from '../src/app/clips/repository.js';
import { APP_PATHS } from '../src/app/config.js';
import { createAppServer } from '../src/app/server.js';
import { planScenes } from '../src/auto-planner.js';
import { exampleWorkspace } from './fixtures.js';

const source = {
  durationMs: 3000,
  captions: [
    { id: 1, startMs: 0, endMs: 1500, text: '왜 이 표현은 어색할까요?' },
    { id: 2, startMs: 1500, endMs: 3000, text: '정리하면 상황에 맞게 바꿔야 합니다.' },
  ],
};

function previewRequest() {
  const { production, source, overrides } = exampleWorkspace().projects[0]!;
  const planned = planScenes({ source });
  assert.equal(planned.valid, true);
  const input = structuredClone({ production, source, overrides });
  input.production.assets.clip01 = { type: 'anime_clip', ...input.production.assets.clip01, status: 'ready', src: 'assets/clip01.mp4' };
  return {
    input,
    handoff: { version: 1, reviewedAt: '2026-09-20T00:00:00.000Z', scenes: planned.scenes, diagnostics: planned.diagnostics },
  };
}

test('AutoPlanner HTTP route returns scenes and diagnostics', async t => {
  const repository = new SourceRepository(':memory:');
  const { createAutoPlannerRoute } = await import('../src/app/auto-planner-routes.js');
  const routed = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube: null, autoPlannerRoute: createAutoPlannerRoute() });
  await new Promise<void>(resolve => routed.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => routed.close(() => resolve())); repository.close(); });
  const base = `http://127.0.0.1:${(routed.address() as { port: number }).port}`;
  const response = await fetch(`${base}/api/auto-planner/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data.scenes.map((scene: { type: string }) => scene.type), ['HOOK', 'RECAP']);
  assert.ok(Array.isArray(payload.data.diagnostics));
});

test('AutoPlanner HTTP route rejects malformed source', async t => {
  const repository = new SourceRepository(':memory:');
  const { createAutoPlannerRoute } = await import('../src/app/auto-planner-routes.js');
  const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube: null, autoPlannerRoute: createAutoPlannerRoute() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); repository.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(`${base}/api/auto-planner/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: { durationMs: 1000, captions: [] } }) });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, 'PLANNER_INVALID');
  assert.ok(Array.isArray(payload.error.diagnostics));
});

test('reviewed scene plan HTTP route returns Preview input', async t => {
  const repository = new SourceRepository(':memory:');
  const { createScenePlanRoute } = await import('../src/app/scene-plan-routes.js');
  const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube: null, scenePlanRoute: createScenePlanRoute() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); repository.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = previewRequest();
  const response = await fetch(`${base}/api/auto-planner/preview-input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const payload = await response.json();
  assert.deepEqual(payload.data.input.production.scenes, request.handoff.scenes);
  assert.ok(Array.isArray(payload.data.diagnostics));
  assert.ok(payload.data.assets);
  assert.ok(payload.data.assets.plan, JSON.stringify(payload.data.assets.diagnostics));
  assert.equal(payload.data.assets.plan.fileVerification, 'not_performed');
  assert.equal(payload.data.assets.plan.renderVerification, 'not_performed');
  assert.ok(Array.isArray(payload.data.assets.plan.finalAssetReadiness.diagnostics));
  assert.ok(Array.isArray(payload.data.assets.diagnostics));
});

test('reviewed scene plan HTTP route uses a stable error envelope', async t => {
  const repository = new SourceRepository(':memory:');
  const { createScenePlanRoute } = await import('../src/app/scene-plan-routes.js');
  const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube: null, scenePlanRoute: createScenePlanRoute() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); repository.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(`${base}/api/auto-planner/preview-input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, 'SCENE_PLAN_INVALID');
  assert.equal(payload.error.message, '검토 완료 장면 계획을 확인하세요.');
  assert.ok(Array.isArray(payload.error.diagnostics));
});
