import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YouTubeApiPublisher } from '../src/app/youtube/api-publisher.js';
import { PublishingResultSchema, type PublishingMetadata } from '../src/models.js';

const secret = 'private-oauth-token';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'youtube-api-publisher-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'output'));
  const bytes = Buffer.from('MP4 fixture bytes \0\xff', 'latin1');
  writeFileSync(join(root, 'output', 'final.mp4'), bytes);
  const metadata: PublishingMetadata = {
    contentId: 'content_long_001', projectId: 'NZ001', videoFile: 'output/final.mp4',
    title: '표현과 관계', description: '업로드 설명', tags: ['일본어', '학습'],
    hashtags: [], playlistIds: [], visibility: 'private',
  };
  return { root, bytes, metadata };
}

function publisher(root: string, fetchImpl: typeof fetch, getAccessToken: () => string | null | undefined | Promise<string | null | undefined> = () => secret) {
  return new YouTubeApiPublisher({ projectRoot: root, getAccessToken, fetch: fetchImpl });
}

function noFetch(): typeof fetch {
  return async () => { throw new Error('Fetch must not be called.'); };
}

function expectFailure(result: Awaited<ReturnType<YouTubeApiPublisher['publish']>>, code: string, retryable: boolean) {
  assert.equal(PublishingResultSchema.safeParse(result).success, true);
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.retryable, retryable);
  assert.ok(result.error.message);
  assert.equal(result.contentId, 'content_long_001');
  assert.equal(result.projectId, 'NZ001');
  assert.equal(JSON.stringify(result).includes(secret), false);
}

test('multipart request uploads exact bytes and maps the returned video ID', async t => {
  const { root, bytes, metadata } = fixture(t);
  let calls = 0;
  const adapter = publisher(root, async (url, init) => {
    calls++;
    assert.equal(url, 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${secret}`);
    assert.match(headers.get('Content-Type') ?? '', /^multipart\/related; boundary=short-auto-[a-f0-9]{32}$/);
    assert.ok(init?.body instanceof Blob);
    const body = Buffer.from(await init.body.arrayBuffer());
    const resource = JSON.stringify({
      snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags },
      status: { privacyStatus: metadata.visibility },
    });
    assert.ok(body.includes(Buffer.from(`Content-Type: application/json; charset=UTF-8\r\n\r\n${resource}\r\n`)));
    assert.ok(body.includes(Buffer.concat([Buffer.from('Content-Type: video/mp4\r\n\r\n'), bytes])));
    return new Response(JSON.stringify({ id: 'video-123' }), { status: 200 });
  });

  const result = await adapter.publish(metadata);
  assert.equal(calls, 1);
  assert.equal(PublishingResultSchema.safeParse(result).success, true);
  assert.equal(result.status, 'uploaded');
  if (result.status !== 'uploaded') return;
  assert.equal(result.videoId, 'video-123');
  assert.equal(result.contentId, metadata.contentId);
  assert.equal(result.projectId, metadata.projectId);
  assert.ok(!Number.isNaN(Date.parse(result.uploadedAt)));
});

test('missing and throwing access token providers fail without an upload', async t => {
  const { root, metadata } = fixture(t);
  expectFailure(await publisher(root, noFetch(), () => '  ').publish(metadata), 'ACCESS_TOKEN_MISSING', false);
  expectFailure(await publisher(root, noFetch(), () => null).publish(metadata), 'ACCESS_TOKEN_MISSING', false);
  expectFailure(await publisher(root, noFetch(), () => { throw new Error(secret); }).publish(metadata), 'ACCESS_TOKEN_UNAVAILABLE', true);
});

test('malformed access token provider results fail without an upload', async t => {
  const { root, metadata } = fixture(t);
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    throw new Error('Fetch must not be called.');
  };
  for (const malformed of [123, { accessToken: secret }]) {
    const getAccessToken = () => malformed as unknown as string;
    expectFailure(await publisher(root, fetchImpl, getAccessToken).publish(metadata), 'ACCESS_TOKEN_MISSING', false);
  }
  assert.equal(calls, 0);
});

test('traversal, absolute paths, and symlink escapes fail before upload', async t => {
  const { root, metadata } = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'youtube-api-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'outside.mp4'), 'outside file');
  symlinkSync(join(outside, 'outside.mp4'), join(root, 'output', 'linked.mp4'));
  const adapter = publisher(root, noFetch());
  for (const videoFile of ['../outside.mp4', '/tmp/outside.mp4', 'C:\\outside.mp4', 'output/../final.mp4', 'output/linked.mp4']) {
    expectFailure(await adapter.publish({ ...metadata, videoFile }), 'VIDEO_FILE_OUTSIDE', false);
  }
});

test('missing or non-file video and scheduled request fail without upload', async t => {
  const { root, metadata } = fixture(t);
  mkdirSync(join(root, 'output', 'directory.mp4'));
  const adapter = publisher(root, noFetch());
  expectFailure(await adapter.publish({ ...metadata, videoFile: 'output/missing.mp4' }), 'VIDEO_FILE_UNAVAILABLE', false);
  expectFailure(await adapter.publish({ ...metadata, videoFile: 'output/directory.mp4' }), 'VIDEO_FILE_UNAVAILABLE', false);
  expectFailure(await adapter.publish({ ...metadata, videoFile: 'output' }), 'VIDEO_FORMAT_UNSUPPORTED', false);
  expectFailure(await adapter.publish({ ...metadata, scheduledPublishAt: '2026-09-21T00:00:00Z' }), 'SCHEDULING_UNSUPPORTED', false);
});

test('HTTP failure has stable sanitized result and retryability', async t => {
  const { root, metadata } = fixture(t);
  for (const [status, retryable] of [[400, false], [403, false], [408, true], [429, true], [500, true]] as const) {
    const adapter = publisher(root, async () => new Response(secret, { status }));
    expectFailure(await adapter.publish(metadata), 'UPLOAD_HTTP_ERROR', retryable);
  }
});

test('malformed success payload cannot produce uploaded status or leak body', async t => {
  const { root, metadata } = fixture(t);
  for (const body of [secret, '{}', '{"id":null}', '{"id":"  "}', '{"id":123}']) {
    const adapter = publisher(root, async () => new Response(body, { status: 200 }));
    expectFailure(await adapter.publish(metadata), 'UPLOAD_INVALID_RESPONSE', false);
  }
});

test('thrown fetch error is sanitized and retryable', async t => {
  const { root, metadata } = fixture(t);
  const adapter = publisher(root, async () => { throw new Error(`network failed: ${secret}`); });
  expectFailure(await adapter.publish(metadata), 'UPLOAD_NETWORK_ERROR', true);
});
