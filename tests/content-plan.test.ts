import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRepository } from '../src/app/clips/repository.js';
import type { SourceClip } from '../src/app/clips/models.js';
import { ContentPlanError, ContentPlanRepository } from '../src/app/content-plans/repository.js';
import { createContentPlanRoute } from '../src/app/content-plans/routes.js';
import { FontRegistry } from '../src/app/fonts/registry.js';
import { createAppServer } from '../src/app/server.js';
import type { SourceFrame } from '../src/app/source-frames/models.js';
import { routeThumbnails } from '../src/app/thumbnail-routes.js';
import { ThumbnailRepository } from '../src/app/thumbnails/repository.js';

function clip(id: string): SourceClip {
  return { id } as SourceClip;
}

function frame(id: string, sourceClipId: string, rightsReviewStatus: SourceFrame['rightsReviewStatus']): SourceFrame {
  return { id, sourceClipId, rightsReviewStatus } as SourceFrame;
}

function workspace(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'content-plan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clips = new Map([['clip-a', clip('clip-a')], ['clip-b', clip('clip-b')]]);
  const frames = new Map([
    ['frame-unchecked', frame('frame-unchecked', 'clip-a', 'unchecked')],
    ['frame-reviewed', frame('frame-reviewed', 'clip-a', 'reviewed')],
    ['frame-rejected', frame('frame-rejected', 'clip-a', 'rejected')],
  ]);
  const repo = new ContentPlanRepository(root, {
    clips: { getClip(id) { const value = clips.get(id); if (!value) throw Object.assign(new Error('clip missing'), { code: 'CLIP_NOT_FOUND', status: 404 }); return value; } },
    frames: { getFrame(id) { const value = frames.get(id); if (!value) throw Object.assign(new Error('frame missing'), { code: 'SOURCE_FRAME_NOT_FOUND', status: 404 }); return value; } },
  });
  return { root, repo };
}

function expectPlanError(operation: () => unknown, code: string, status?: number) {
  assert.throws(operation, error => {
    assert.ok(error instanceof ContentPlanError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

test('ContentPlan schema persists required and optional fields and rejects inverse thumbnail ownership', t => {
  const { repo } = workspace(t);
  const created = repo.createContentPlan({
    contentId: 'content-1', contentType: 'discovery_long', title: '첫 콘텐츠', status: 'DRAFT',
    hookText: '첫 3초 훅', sourceClipId: 'clip-a', publishedAt: '2026-09-18T00:00:00Z',
  });
  assert.equal(created.contentId, 'content-1');
  assert.equal(created.hookText, '첫 3초 훅');
  assert.equal(created.sourceFrameId, undefined);
  assert.equal(created.createdAt, created.updatedAt);
  assert.deepEqual(repo.getContentPlan(created.contentId), created);
  assert.deepEqual(repo.listContentPlans(), [created]);

  for (const missing of ['contentId', 'contentType', 'title', 'status'] as const) {
    const input: Record<string, unknown> = { contentId: `missing-${missing}`, contentType: 'discovery_long', title: '필수값', status: 'DRAFT' };
    delete input[missing];
    expectPlanError(() => repo.createContentPlan(input), 'INVALID_INPUT');
  }
  expectPlanError(() => repo.createContentPlan({
    contentId: 'bad-owner', contentType: 'discovery_long', title: '역참조 금지', status: 'DRAFT', thumbnailProjectId: 'thumb-1',
  }), 'INVALID_INPUT');
});

test('ContentPlan CRUD enforces source existence, identity and rights-review gates', t => {
  const { repo } = workspace(t);
  const unchecked = repo.createContentPlan({
    contentId: 'unchecked', contentType: 'learning_short', title: '검수 전', status: 'IN_PROGRESS',
    sourceClipId: 'clip-a', sourceFrameId: 'frame-unchecked',
  });
  assert.equal(repo.warningsFor(unchecked)[0]?.code, 'SOURCE_FRAME_UNCHECKED');
  assert.equal(repo.updateContentPlan(unchecked.contentId, { title: '미리보기 편집 가능' }).title, '미리보기 편집 가능');
  expectPlanError(() => repo.updateContentPlan(unchecked.contentId, { status: 'READY' }), 'SOURCE_FRAME_REVIEW_REQUIRED', 409);
  expectPlanError(() => repo.updateContentPlan(unchecked.contentId, { status: 'PUBLISHED' }), 'SOURCE_FRAME_REVIEW_REQUIRED', 409);

  const reviewed = repo.createContentPlan({
    contentId: 'reviewed', contentType: 'training_long', title: '검수 완료', status: 'READY',
    sourceClipId: 'clip-a', sourceFrameId: 'frame-reviewed',
  });
  assert.equal(repo.updateContentPlan(reviewed.contentId, { status: 'PUBLISHED', publishedAt: '2026-09-18T02:00:00Z' }).status, 'PUBLISHED');
  assert.deepEqual(repo.warningsFor(reviewed), []);

  expectPlanError(() => repo.createContentPlan({
    contentId: 'rejected', contentType: 'learning_short', title: '거부', status: 'DRAFT', sourceFrameId: 'frame-rejected',
  }), 'SOURCE_FRAME_REJECTED', 409);
  expectPlanError(() => repo.createContentPlan({
    contentId: 'mismatch', contentType: 'learning_short', title: '불일치', status: 'DRAFT', sourceClipId: 'clip-b', sourceFrameId: 'frame-reviewed',
  }), 'SOURCE_CLIP_FRAME_MISMATCH', 409);
  assert.throws(() => repo.createContentPlan({
    contentId: 'missing-clip', contentType: 'learning_short', title: '없는 클립', status: 'DRAFT', sourceClipId: 'clip-missing',
  }), (error: any) => error.code === 'CLIP_NOT_FOUND' && error.status === 404);
  assert.throws(() => repo.createContentPlan({
    contentId: 'missing-frame', contentType: 'learning_short', title: '없는 프레임', status: 'DRAFT', sourceFrameId: 'frame-missing',
  }), (error: any) => error.code === 'SOURCE_FRAME_NOT_FOUND' && error.status === 404);
});

test('HTTP CRUD links one PRIMARY and multiple VARIANT projects while preserving content lineage', async t => {
  const root = mkdtempSync(join(tmpdir(), 'content-plan-http-'));
  const sources = new SourceRepository(':memory:');
  const thumbnails = new ThumbnailRepository(root);
  const plans = new ContentPlanRepository(root, {
    clips: sources,
    frames: { getFrame() { throw Object.assign(new Error('missing'), { code: 'SOURCE_FRAME_NOT_FOUND', status: 404 }); } },
  });
  const fonts = new FontRegistry();
  const server = createAppServer({ repository: sources, root, youtube: null,
    thumbnailRoute: (req, res, path, method, body, json) => routeThumbnails(thumbnails, req, res, path, method, body, json, fonts, undefined, plans),
    contentPlanRoute: createContentPlanRoute(plans, thumbnails),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    sources.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = 'GET', value?: unknown) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const create = await request('/api/content-plans', 'POST', {
    contentId: 'content-http', contentType: 'discovery_long', title: 'HTTP 계획', status: 'PLANNED',
  });
  assert.equal(create.status, 201);
  assert.deepEqual((await create.json()).meta.warnings, []);
  assert.equal((await request('/api/content-plans/content-http', 'PATCH', { hookText: '연결 훅' })).status, 200);

  const primaryResponse = await request('/api/thumbnail-projects', 'POST', {
    contentId: 'content-http', name: 'A', templateId: 'discovery_long_v1',
  });
  assert.equal(primaryResponse.status, 201);
  const primary = (await primaryResponse.json()).data;
  assert.equal(primary.contentId, 'content-http');
  const duplicate = await request('/api/thumbnail-projects', 'POST', {
    contentId: 'content-http', name: '중복 A', templateId: 'discovery_long_v1',
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'CONTENT_PRIMARY_EXISTS');

  const first = (await (await request(`/api/thumbnail-projects/${primary.id}/variants`, 'POST', { name: 'B' })).json()).data;
  const second = (await (await request(`/api/thumbnail-projects/${first.id}/variants`, 'POST', { name: 'C' })).json()).data;
  assert.equal(first.contentId, 'content-http');
  assert.equal(second.contentId, 'content-http');
  assert.equal(first.variantOfProjectId, primary.id);
  assert.equal(second.variantOfProjectId, primary.id);

  const fetched = await (await request('/api/content-plans/content-http')).json();
  assert.equal(fetched.data.thumbnailProjects.length, 3);
  assert.equal(fetched.data.thumbnailProjects.filter((project: any) => project.variantOfProjectId === null).length, 1);
  assert.equal((await request('/api/thumbnail-projects', 'POST', {
    contentId: 'missing-content', name: '고아', templateId: 'discovery_long_v1',
  })).status, 404);
});

test('ThumbnailProject reads legacy JSON without contentId as null', t => {
  const root = mkdtempSync(join(tmpdir(), 'thumbnail-content-backcompat-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = new ThumbnailRepository(root);
  const project = repo.createProject({ name: '레거시', templateId: 'discovery_long_v1' });
  const file = join(root, 'data', 'thumbnail-projects', project.id, 'project.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  delete raw.contentId;
  writeFileSync(file, JSON.stringify(raw));
  assert.equal(repo.getProject(project.id).contentId, null);
});
