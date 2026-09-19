import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceRepository } from '../src/app/clips/repository.js';
import { APP_PATHS } from '../src/app/config.js';
import { createAppServer } from '../src/app/server.js';

const source = {
  durationMs: 3000,
  captions: [
    { id: 1, startMs: 0, endMs: 1500, text: '왜 이 표현은 어색할까요?' },
    { id: 2, startMs: 1500, endMs: 3000, text: '정리하면 상황에 맞게 바꿔야 합니다.' },
  ],
};

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
