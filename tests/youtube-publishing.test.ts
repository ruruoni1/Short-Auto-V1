import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleWorkspace } from './fixtures.js';
import { YouTubePublishingBoundary, type PublishingRequest } from '../src/app/youtube/publishing.js';
import type { ContentPlan } from '../src/app/content-plans/models.js';
import type { SourceFrame } from '../src/app/source-frames/models.js';
import type { ThumbnailProject } from '../src/app/thumbnails/models.js';
import type { Publisher, PublishingResult } from '../src/models.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const codes = (value: { diagnostics: { code: string }[] }) => value.diagnostics.map(item => item.code);

function fixture(t: TestContext, publisher?: Publisher) {
  const root = mkdtempSync(join(tmpdir(), 'youtube-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'output'));
  const video = Buffer.from('verified final mp4 fixture');
  writeFileSync(join(root, 'output', 'final.mp4'), video);
  const workspace = exampleWorkspace();
  const bundle = workspace.projects[0]!;
  bundle.production.project.status = 'rendered';
  bundle.production.assets.clip01 = { type: 'anime_clip', status: 'ready', src: 'assets/clip.mp4', durationMs: 1000 };
  bundle.approval = { projectId: 'NZ001', productionRevision: 0, overridesRevision: 0, approvedAt: '2026-09-20T00:00:00Z', approvedBy: 'reviewer' };
  workspace.contents[0]!.status = 'upload_ready';
  const plan = { contentId: 'content_long_001', contentType: 'discovery_long', title: '표현과 관계', status: 'READY', sourceFrameId: 'frame-1', sourceClipId: 'clip-1' } as ContentPlan;
  const frame = { id: 'frame-1', sourceClipId: 'clip-1', rightsReviewStatus: 'reviewed', sha256: 'a'.repeat(64) } as SourceFrame;
  const projects: ThumbnailProject[] = [];
  const request: PublishingRequest = {
    metadata: { contentId: plan.contentId, projectId: 'NZ001', videoFile: 'output/final.mp4', title: '표현과 관계', description: '설명', tags: ['일본어'], hashtags: ['#일본어'], playlistIds: [], visibility: 'private' },
    render: { kind: 'final', projectId: 'NZ001', videoFile: 'output/final.mp4', productionRevision: 0, overridesRevision: 0, byteLength: video.length, sha256: digest(video), fullDecodePassed: true, verifiedAt: '2026-09-20T00:00:00Z' },
  };
  const boundary = new YouTubePublishingBoundary({
    projectRoot: root, getWorkspace: () => workspace,
    contentPlans: { getContentPlan: () => plan },
    sourceFrames: { getFrame: () => frame },
    thumbnails: { listProjects: () => projects },
    ...(publisher ? { publisher } : {}),
  });
  return { root, workspace, bundle, plan, frame, projects, request, boundary };
}

test('dry run verifies final render and READY plan without invoking publisher', async t => {
  let calls = 0;
  const f = fixture(t, { async publish() { calls++; throw new Error('must not run'); } });
  const result = await f.boundary.review(f.request);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(calls, 0);
});

test('Core readiness, render revision and ContentPlan state block injected publisher', async t => {
  let calls = 0;
  const f = fixture(t, { async publish() { calls++; throw new Error('must not run'); } });
  f.bundle.approval = undefined;
  assert.ok(codes(await f.boundary.publish(f.request)).includes('APPROVAL_REQUIRED'));
  f.bundle.approval = { projectId: 'NZ001', productionRevision: 0, overridesRevision: 0, approvedAt: '2026-09-20T00:00:00Z', approvedBy: 'reviewer' };
  f.plan.status = 'IN_PROGRESS';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('CONTENT_PLAN_NOT_READY'));
  f.plan.status = 'READY';
  f.request.render.productionRevision = 1;
  assert.ok(codes(await f.boundary.publish(f.request)).includes('RENDER_EVIDENCE_MISMATCH'));
  assert.equal(calls, 0);
});

test('live SourceFrame rights and linked thumbnail export gate publisher calls', async t => {
  let calls = 0;
  const f = fixture(t, { async publish() { calls++; throw new Error('must not run'); } });
  f.frame.rightsReviewStatus = 'rejected';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('SOURCE_FRAME_REVIEW_REQUIRED'));
  f.frame.rightsReviewStatus = 'reviewed';
  f.request.metadata.thumbnail = 'output/thumbnail.png';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('THUMBNAIL_EXPORT_REQUIRED'));
  const image = Buffer.from('exported thumbnail fixture');
  writeFileSync(join(f.root, 'output', 'thumbnail.png'), image);
  f.projects.push({
    id: 'thumb-1', contentId: f.plan.contentId, revision: 2, baseImage: { sourceFrame: { sourceFrameId: f.frame.id, sourceClipId: f.frame.sourceClipId } },
    exports: [{ path: 'output/thumbnail.png', byteLength: image.length, sha256: digest(image), productionRevision: 0 }],
  } as ThumbnailProject);
  assert.ok(codes(await f.boundary.publish(f.request)).includes('THUMBNAIL_EXPORT_STALE'));
  f.projects[0]!.revision = 1;
  assert.ok(codes(await f.boundary.publish(f.request)).includes('THUMBNAIL_SOURCE_MISMATCH'));
  f.projects[0]!.baseImage!.sha256 = f.frame.sha256;
  f.frame.rightsReviewStatus = 'unchecked';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('THUMBNAIL_RIGHTS_REVIEW_REQUIRED'));
  assert.equal(calls, 0);
});

test('current reviewed thumbnail export and its exact file pass the dry run', async t => {
  const f = fixture(t);
  const image = Buffer.from('current thumbnail export');
  writeFileSync(join(f.root, 'output', 'thumbnail.png'), image);
  f.request.metadata.thumbnail = 'output/thumbnail.png';
  f.projects.push({
    id: 'thumb-1', contentId: f.plan.contentId, revision: 1,
    baseImage: { sha256: f.frame.sha256, sourceFrame: { sourceFrameId: f.frame.id, sourceClipId: f.frame.sourceClipId } },
    exports: [{ path: 'output/thumbnail.png', byteLength: image.length, sha256: digest(image), productionRevision: 0 }],
  } as ThumbnailProject);
  assert.equal((await f.boundary.review(f.request)).status, 'ready');
  writeFileSync(join(f.root, 'output', 'thumbnail.png'), Buffer.from('tampered thumbnail export'));
  assert.ok(codes(await f.boundary.review(f.request)).includes('THUMBNAIL_FILE_MISMATCH'));
});

test('local file path, symlink escape, digest and metadata are validated', async t => {
  let calls = 0;
  const f = fixture(t, { async publish() { calls++; throw new Error('must not run'); } });
  f.request.metadata.videoFile = '../outside.mp4';
  f.request.render.videoFile = '../outside.mp4';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('INVALID_INPUT'));
  f.request.metadata.videoFile = 'output/final.mp4';
  f.request.render.videoFile = 'output/final.mp4';
  const outside = mkdtempSync(join(tmpdir(), 'youtube-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'outside.mp4'), Buffer.from('verified final mp4 fixture'));
  symlinkSync(join(outside, 'outside.mp4'), join(f.root, 'output', 'linked.mp4'));
  f.request.metadata.videoFile = 'output/linked.mp4';
  f.request.render.videoFile = 'output/linked.mp4';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('VIDEO_FILE_OUTSIDE'));
  f.request.metadata.videoFile = 'output/final.mp4';
  f.request.render.videoFile = 'output/final.mp4';
  f.request.render.sha256 = '0'.repeat(64);
  assert.ok(codes(await f.boundary.publish(f.request)).includes('VIDEO_FILE_MISMATCH'));
  f.request.render.sha256 = digest(Buffer.from('verified final mp4 fixture'));
  f.request.metadata.title = ' title ';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('TITLE_INVALID'));
  f.request.metadata.title = 'title';
  f.request.metadata.scheduledPublishAt = '2026-09-21T00:00:00Z';
  assert.ok(codes(await f.boundary.publish(f.request)).includes('SCHEDULING_UNSUPPORTED'));
  assert.equal(calls, 0);
});

test('publisher success maps IDs, while failure and thrown secrets are sanitized', async t => {
  let returned: PublishingResult = { status: 'uploaded', contentId: 'content_long_001', projectId: 'NZ001', videoId: 'video-123', uploadedAt: '2026-09-20T00:01:00Z' };
  let calls = 0;
  const f = fixture(t, { async publish(metadata) { calls++; assert.equal(metadata.title, '표현과 관계'); return returned; } });
  const success = await f.boundary.publish(f.request);
  assert.equal(success.status, 'uploaded');
  assert.equal(success.result?.status, 'uploaded');
  assert.equal(calls, 1);
  returned = { status: 'failed', contentId: 'content_long_001', projectId: 'NZ001', error: { code: 'secret-token', message: 'token=private', retryable: true } };
  const failure = await f.boundary.publish(f.request);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.result?.status, 'failed');
  assert.equal(failure.result?.status === 'failed' && failure.result.error.retryable, true);
  assert.equal(JSON.stringify(failure).includes('secret-token'), false);
  assert.equal(JSON.stringify(failure).includes('token=private'), false);
  returned = { status: 'uploaded', contentId: 'another', projectId: 'NZ001', videoId: 'bad', uploadedAt: '2026-09-20T00:01:00Z' };
  assert.ok(codes(await f.boundary.publish(f.request)).includes('PUBLISHER_INVALID_RESULT'));
  const throwing = fixture(t, { async publish() { throw new Error('oauth-token=private'); } });
  assert.equal(JSON.stringify(await throwing.boundary.publish(throwing.request)).includes('oauth-token'), false);
  assert.equal(calls, 3);
});

test('without injected publisher, ready request remains local', async t => {
  const f = fixture(t);
  assert.equal((await f.boundary.review(f.request)).status, 'ready');
  assert.ok(codes(await f.boundary.publish(f.request)).includes('PUBLISHER_UNAVAILABLE'));
});
