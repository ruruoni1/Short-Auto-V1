import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { exampleWorkspace } from './fixtures.js';
import type { ContentPlan } from '../src/app/content-plans/models.js';
import type { SourceFrame } from '../src/app/source-frames/models.js';
import type { PublishingRequest } from '../src/app/youtube/publishing.js';
import { createStartupYouTubePublishingRoute, type PublishingApprovalProvider } from '../src/app/youtube/startup.js';
import { createYouTubeWorkspaceProvider } from '../src/app/youtube/workspace-provider.js';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'youtube-workspace-provider-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'output'));
  mkdirSync(join(root, 'snapshots'));
  const video = Buffer.from('verified final mp4 fixture');
  writeFileSync(join(root, 'output', 'final.mp4'), video);
  const workspace = exampleWorkspace();
  const bundle = workspace.projects[0]!;
  bundle.production.project.status = 'rendered';
  bundle.production.assets.clip01 = { type: 'anime_clip', status: 'ready', src: 'assets/clip.mp4', durationMs: 1000 };
  bundle.approval = { projectId: 'NZ001', productionRevision: 0, overridesRevision: 0,
    approvedAt: '2026-09-20T00:00:00Z', approvedBy: 'reviewer' };
  workspace.contents[0]!.status = 'upload_ready';
  const plan = { contentId: 'content_long_001', contentType: 'discovery_long', title: 'title', status: 'READY',
    sourceFrameId: 'frame-1', sourceClipId: 'clip-1' } as ContentPlan;
  const frame = { id: 'frame-1', sourceClipId: 'clip-1', rightsReviewStatus: 'reviewed' } as SourceFrame;
  const request: PublishingRequest = {
    metadata: { contentId: plan.contentId, projectId: 'NZ001', videoFile: 'output/final.mp4',
      title: 'title', description: '', tags: [], hashtags: [], playlistIds: [], visibility: 'private' },
    render: { kind: 'final', projectId: 'NZ001', videoFile: 'output/final.mp4', productionRevision: 0,
      overridesRevision: 0, byteLength: video.length, sha256: createHash('sha256').update(video).digest('hex'),
      fullDecodePassed: true, verifiedAt: '2026-09-20T00:00:00Z' },
  };
  const snapshotPath = 'snapshots/workspace.json';
  const file = join(root, 'snapshots', 'workspace.json');
  const writeSnapshot = (revision: number) => writeFileSync(file, JSON.stringify({ schemaVersion: 1, revision, workspace }));
  const createRoute = (configuredPath: string | undefined, approvalProvider?: PublishingApprovalProvider) => createStartupYouTubePublishingRoute({
    projectRoot: root,
    getWorkspace: createYouTubeWorkspaceProvider(root, configuredPath),
    contentPlans: { getContentPlan: () => plan },
    sourceFrames: { getFrame: () => frame },
    thumbnails: { listProjects: () => [] },
  }, approvalProvider);
  async function review(route: ReturnType<typeof createRoute>, path = '/api/youtube/publishing/review') {
    let response: { status: number; value: unknown } | undefined;
    const handled = await route({} as never, {} as never, path, 'POST',
      async () => request, (_res, status, value) => { response = { status, value }; });
    assert.equal(handled, true);
    assert.ok(response);
    return response;
  }
  return { root, workspace, file, snapshotPath, writeSnapshot, createRoute, review };
}

test('configured snapshot is read for each review and snapshot revision grants no approval', async t => {
  const f = fixture(t);
  const route = f.createRoute(f.snapshotPath);
  f.writeSnapshot(99);
  assert.equal((await f.review(route)).status, 200);

  const bundle = f.workspace.projects[0]!;
  bundle.production.project.revision = 1;
  bundle.approval = { ...bundle.approval!, productionRevision: 1 };
  f.writeSnapshot(100);
  const stale = await f.review(route);
  assert.equal(stale.status, 409);
  assert.match(JSON.stringify(stale.value), /RENDER_EVIDENCE_MISMATCH/);
});

test('approval-time snapshot changes are caught by the final review before publishing', async t => {
  for (const change of ['delete', 'stale'] as const) {
    await t.test(change, async child => {
      const f = fixture(child);
      f.writeSnapshot(1);
      let approvals = 0;
      let publishes = 0;
      const route = f.createRoute(f.snapshotPath, {
        async approve() {
          approvals += 1;
          if (change === 'delete') unlinkSync(f.file);
          else {
            const bundle = f.workspace.projects[0]!;
            bundle.production.project.revision = 1;
            bundle.approval = { ...bundle.approval!, productionRevision: 1 };
            f.writeSnapshot(2);
          }
          return { async publish() {
            publishes += 1;
            return { status: 'uploaded' as const, contentId: 'content_long_001', projectId: 'NZ001',
              videoId: 'unexpected', uploadedAt: '2026-09-20T00:01:00Z' };
          } };
        },
      });
      const attempt = await f.review(route, '/api/youtube/publishing/attempt');
      assert.equal(attempt.status, 409);
      assert.equal(approvals, 1);
      assert.equal(publishes, 0);
      assert.match(JSON.stringify(attempt.value), change === 'delete' ? /WORKSPACE_UNAVAILABLE/ : /RENDER_EVIDENCE_MISMATCH/);
    });
  }
});

test('missing configuration, deleted, corrupt and unsafe snapshots block review without leaking paths', async t => {
  const f = fixture(t);
  assert.equal((await f.review(f.createRoute(undefined))).status, 409);

  const configured = f.createRoute(f.snapshotPath);
  f.writeSnapshot(1);
  assert.equal((await f.review(configured)).status, 200);
  unlinkSync(f.file);
  for (const value of [undefined, '{', JSON.stringify({ schemaVersion: 2, revision: 2, workspace: f.workspace })]) {
    if (value !== undefined) writeFileSync(f.file, value);
    const result = await f.review(configured);
    assert.equal(result.status, 409);
    assert.match(JSON.stringify(result.value), /WORKSPACE_UNAVAILABLE/);
    assert.equal(JSON.stringify(result.value).includes(f.root), false);
  }

  for (const path of ['../outside.json', 'C:\\outside.json', '']) {
    const result = await f.review(f.createRoute(path));
    assert.equal(result.status, 409);
    assert.match(JSON.stringify(result.value), /WORKSPACE_UNAVAILABLE/);
  }
});
