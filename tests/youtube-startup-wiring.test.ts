import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { exampleWorkspace } from './fixtures.js';
import { createStartupYouTubePublishingRoute, type PublishingApprovalProvider } from '../src/app/youtube/startup.js';
import type { PublishingRequest } from '../src/app/youtube/publishing.js';
import type { ContentPlan } from '../src/app/content-plans/models.js';
import type { SourceFrame } from '../src/app/source-frames/models.js';

function fixture(t: TestContext, approvalProvider?: PublishingApprovalProvider) {
  const root = mkdtempSync(join(tmpdir(), 'youtube-startup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'output'));
  const video = Buffer.from('verified fixture');
  writeFileSync(join(root, 'output', 'final.mp4'), video);
  const workspace = exampleWorkspace();
  const bundle = workspace.projects[0]!;
  bundle.production.project.status = 'rendered';
  bundle.production.assets.clip01 = { type: 'anime_clip', status: 'ready', src: 'assets/clip.mp4', durationMs: 1000 };
  bundle.approval = { projectId: 'NZ001', productionRevision: 0, overridesRevision: 0, approvedAt: '2026-09-20T00:00:00Z', approvedBy: 'reviewer' };
  workspace.contents[0]!.status = 'upload_ready';
  const plan = { contentId: 'content_long_001', contentType: 'discovery_long', title: 'title', status: 'READY', sourceFrameId: 'frame-1', sourceClipId: 'clip-1' } as ContentPlan;
  const frame = { id: 'frame-1', sourceClipId: 'clip-1', rightsReviewStatus: 'reviewed' } as SourceFrame;
  const request: PublishingRequest = {
    metadata: { contentId: plan.contentId, projectId: 'NZ001', videoFile: 'output/final.mp4', title: 'title', description: '', tags: [], hashtags: [], playlistIds: [], visibility: 'private' },
    render: { kind: 'final', projectId: 'NZ001', videoFile: 'output/final.mp4', productionRevision: 0, overridesRevision: 0, byteLength: video.length, sha256: createHash('sha256').update(video).digest('hex'), fullDecodePassed: true, verifiedAt: '2026-09-20T00:00:00Z' },
  };
  const route = createStartupYouTubePublishingRoute({
    projectRoot: root,
    getWorkspace: () => workspace,
    contentPlans: { getContentPlan: () => plan },
    sourceFrames: { getFrame: () => frame },
    thumbnails: { listProjects: () => [] },
  }, approvalProvider);
  async function call(path: string, input: unknown) {
    let response: { status: number; value: unknown } | undefined;
    const handled = await route({} as never, {} as never, path, 'POST', async () => input,
      (_res, status, value) => { response = { status, value }; });
    return { handled, response };
  }
  return { request, plan, call };
}

test('startup route exposes review and blocks attempts without an approval provider', async t => {
  const f = fixture(t);
  const review = await f.call('/api/youtube/publishing/review', f.request);
  assert.equal(review.handled, true);
  assert.equal(review.response?.status, 200);
  const attempt = await f.call('/api/youtube/publishing/attempt', f.request);
  assert.equal(attempt.response?.status, 409);
  assert.match(JSON.stringify(attempt.response), /PUBLISHER_UNAVAILABLE/);
});

test('approval and publisher run only after review passes, with a fresh review before publish', async t => {
  let approvals = 0;
  let uploads = 0;
  let revokeAfterApproval = false;
  const f = fixture(t, { async approve(metadata) {
    approvals++;
    assert.equal(metadata.projectId, 'NZ001');
    if (revokeAfterApproval) f.plan.status = 'IN_PROGRESS';
    return { async publish() {
      uploads++;
      return { status: 'uploaded', contentId: metadata.contentId, projectId: metadata.projectId, videoId: 'video-1', uploadedAt: '2026-09-20T00:01:00Z' };
    } };
  } });
  f.plan.status = 'IN_PROGRESS';
  assert.equal((await f.call('/api/youtube/publishing/attempt', f.request)).response?.status, 409);
  assert.equal(approvals, 0);
  f.plan.status = 'READY';
  assert.equal((await f.call('/api/youtube/publishing/review', f.request)).response?.status, 200);
  assert.equal(approvals, 0);
  assert.equal((await f.call('/api/youtube/publishing/attempt', f.request)).response?.status, 200);
  assert.equal(approvals, 1);
  assert.equal(uploads, 1);
  revokeAfterApproval = true;
  assert.equal((await f.call('/api/youtube/publishing/attempt', f.request)).response?.status, 409);
  assert.equal(approvals, 2);
  assert.equal(uploads, 1);
});

test('malformed input and provider failures remain blocked and sanitized', async t => {
  let approvals = 0;
  const f = fixture(t, { async approve() { approvals++; throw new Error('token=private'); } });
  const malformed = await f.call('/api/youtube/publishing/attempt', { ...f.request, accessToken: 'secret-request-value' });
  assert.equal(malformed.response?.status, 409);
  assert.equal(approvals, 0);
  assert.equal(JSON.stringify(malformed.response).includes('secret-request-value'), false);
  const denied = await f.call('/api/youtube/publishing/attempt', f.request);
  assert.equal(denied.response?.status, 409);
  assert.match(JSON.stringify(denied.response), /PUBLISHING_APPROVAL_REQUIRED/);
  assert.equal(JSON.stringify(denied.response).includes('token=private'), false);
  assert.equal(approvals, 1);
});
