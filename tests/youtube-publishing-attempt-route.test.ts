import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createYouTubePublishingRoute } from '../src/app/youtube/routes.js';

type CapturedResponse = { status: number; value: unknown };

function request(body: unknown): Readable & { headers: Record<string, string> } {
  const stream = Readable.from([JSON.stringify(body)]) as Readable & { headers: Record<string, string> };
  stream.headers = { 'content-type': 'application/json' };
  return stream;
}

function harness(boundary: { publish(input: unknown): Promise<unknown> }) {
  const route = createYouTubePublishingRoute(boundary as Parameters<typeof createYouTubePublishingRoute>[0]);
  return async (path: string, method: string, input: unknown): Promise<{ handled: boolean; response?: CapturedResponse }> => {
    let response: CapturedResponse | undefined;
    const handled = await route(
      request(input) as never, {} as never, path, method,
      async req => JSON.parse((await new Promise<string>(resolve => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }))),
      (_res, status, value) => { response = { status, value }; },
    );
    return response ? { handled, response } : { handled };
  };
}

test('publishing attempt route returns uploaded result', async () => {
  const result = { status: 'uploaded', contentId: 'content-1', projectId: 'project-1', videoId: 'video-1', uploadedAt: '2026-09-20T00:00:00Z' };
  const run = harness({ publish: async input => {
    assert.deepEqual(input, { request: true });
    return { status: 'uploaded', diagnostics: [], result };
  } });

  assert.deepEqual(await run('/api/youtube/publishing/attempt', 'POST', { request: true }), {
    handled: true,
    response: { status: 200, value: { data: { status: 'uploaded', result } } },
  });
});

test('publishing attempt route returns blocked diagnostics', async () => {
  const diagnostics = [{ severity: 'error', code: 'REVIEW_BLOCKED', path: 'metadata', message: 'bad' }];
  const run = harness({ publish: async () => ({ status: 'blocked', diagnostics }) });

  assert.deepEqual(await run('/api/youtube/publishing/attempt', 'POST', {}), {
    handled: true,
    response: { status: 409, value: { error: { code: 'YOUTUBE_PUBLISHING_BLOCKED', message: '게시 전 검수에 실패했습니다.', diagnostics } } },
  });
});

test('publishing attempt route returns failed publisher result', async () => {
  const diagnostics = [{ severity: 'error', code: 'PUBLISHER_FAILED', path: 'publisher', message: 'failed' }];
  const result = { status: 'failed', contentId: 'content-1', projectId: 'project-1', error: { code: 'UPLOAD_FAILED', message: 'failed', retryable: true } };
  const run = harness({ publish: async () => ({ status: 'failed', diagnostics, result }) });

  assert.deepEqual(await run('/api/youtube/publishing/attempt', 'POST', {}), {
    handled: true,
    response: { status: 502, value: { error: { code: 'YOUTUBE_PUBLISHING_FAILED', message: '게시에 실패했습니다.', diagnostics, result } } },
  });
});

test('publishing attempt route ignores unknown paths and methods', async () => {
  const run = harness({ publish: async () => ({ status: 'blocked', diagnostics: [] }) });

  assert.deepEqual(await run('/api/youtube/publishing', 'POST', {}), { handled: false });
  assert.deepEqual(await run('/api/youtube/publishing/attempt', 'GET', {}), { handled: false });
});
