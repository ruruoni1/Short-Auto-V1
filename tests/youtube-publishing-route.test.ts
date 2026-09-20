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

function harness(boundary: { review(input: unknown): Promise<unknown> }) {
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

test('publishing review route returns a stable ready envelope', async () => {
  const diagnostics = [{ severity: 'warning', code: 'NOTICE', path: 'metadata', message: 'ok' }];
  const metadata = { contentId: 'content-1', projectId: 'project-1' };
  const run = harness({ review: async input => {
    assert.deepEqual(input, { request: true });
    return { status: 'ready', diagnostics, metadata };
  } });

  const result = await run('/api/youtube/publishing/review', 'POST', { request: true });

  assert.deepEqual(result, {
    handled: true,
    response: { status: 200, value: { data: { status: 'ready', diagnostics, metadata } } },
  });
});

test('publishing review route returns a blocked error envelope', async () => {
  const diagnostics = [{ severity: 'error', code: 'INVALID_INPUT', path: 'metadata', message: 'bad' }];
  const run = harness({ review: async () => ({ status: 'blocked', diagnostics }) });

  const result = await run('/api/youtube/publishing/review', 'POST', { request: false });

  assert.deepEqual(result, {
    handled: true,
    response: {
      status: 409,
      value: {
        error: {
          code: 'YOUTUBE_PUBLISHING_BLOCKED',
          message: '게시 전 검수에 실패했습니다.',
          diagnostics,
        },
      },
    },
  });
});

test('publishing review route ignores unknown paths and methods', async () => {
  const run = harness({ review: async () => ({ status: 'ready', diagnostics: [], metadata: {} }) });

  assert.deepEqual(await run('/api/youtube/publishing', 'POST', {}), { handled: false });
  assert.deepEqual(await run('/api/youtube/publishing/review', 'GET', {}), { handled: false });
});
