import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRepository } from '../src/app/clips/repository.js';
import { createAppServer } from '../src/app/server.js';
import { VoicevoxClient } from '../src/app/voicevox/client.js';
import { VoicevoxError } from '../src/app/voicevox/models.js';
import { VoicevoxRepository } from '../src/app/voicevox/repository.js';
import { createVoicevoxRoute } from '../src/app/voicevox/routes.js';
import { VoicevoxService } from '../src/app/voicevox/service.js';

const speakers = [{ speaker_uuid: 'dynamic-speaker-uuid', name: '동적 화자', version: '1.0.0', styles: [
  { id: 7, name: '노멀', type: 'talk' }, { id: 19, name: '차분함', type: 'talk' },
] }];
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
const audioQuery = { accent_phrases: [], speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1,
  prePhonemeLength: 0.1, postPhonemeLength: 0.1, outputSamplingRate: 24_000, outputStereo: false,
};

function mock(handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => handler(new URL(String(input)), init)) as typeof fetch;
}

function root(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'short-auto-voicevox-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('VOICEVOX endpoint defaults locally and rejects external or disguised endpoints', () => {
  assert.equal(new VoicevoxClient().endpoint, 'http://127.0.0.1:50021');
  assert.equal(new VoicevoxClient({ endpoint: 'http://localhost:50021' }).endpoint, 'http://localhost:50021');
  for (const endpoint of [
    'https://127.0.0.1:50021', 'http://voicevox.example:50021', 'http://127.0.0.1.evil.test:50021',
    'http://127.0.0.1:50021/proxy', 'http://user@127.0.0.1:50021',
  ]) assert.throws(() => new VoicevoxClient({ endpoint }), VoicevoxError);
});

test('health reports success, unavailable and invalid response without throwing', async () => {
  const success = new VoicevoxClient({ fetch: mock(url => {
    assert.equal(url.pathname, '/version');
    return Response.json('0.22.0');
  }) });
  assert.deepEqual(await success.health(), { status: 'success', endpoint: 'http://127.0.0.1:50021', version: '0.22.0' });

  const unavailable = new VoicevoxClient({ fetch: mock(() => { throw new TypeError('connection refused secret'); }) });
  const unavailableHealth = await unavailable.health();
  assert.equal(unavailableHealth.status, 'unavailable');
  if (unavailableHealth.status === 'unavailable') {
    assert.equal(unavailableHealth.error.code, 'ENGINE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(unavailableHealth), /secret/);
  }

  const invalid = new VoicevoxClient({ fetch: mock(() => Response.json({ version: 'wrong shape' })) });
  const invalidHealth = await invalid.health();
  assert.equal(invalidHealth.status, 'error');
  if (invalidHealth.status === 'error') assert.equal(invalidHealth.error.kind, 'invalid_response');
});

test('dynamic speaker identity is preserved in a named profile and missing styles require reselection', async t => {
  const projectRoot = root(t);
  let listed = 0;
  const client = new VoicevoxClient({ fetch: mock(url => {
    assert.equal(url.pathname, '/speakers'); listed += 1;
    return Response.json(speakers);
  }) });
  const repository = new VoicevoxRepository(projectRoot);
  const service = new VoicevoxService(client, repository);
  const list = await service.listSpeakers();
  assert.deepEqual(list.voices[1], { speakerUuid: 'dynamic-speaker-uuid', speakerName: '동적 화자', styleId: 19, styleName: '차분함' });
  assert.equal(service.loadProfile(), null);
  const profile = await service.saveProfile({ profileName: '니혼줍줍 기본', speakerUuid: 'dynamic-speaker-uuid', styleId: 19,
    parameters: { speedScale: 1.1, pitchScale: 0.01 },
  });
  assert.equal(profile.speakerName, '동적 화자');
  assert.equal(profile.styleName, '차분함');
  assert.deepEqual(new VoicevoxRepository(projectRoot).loadProfile(), profile);
  await assert.rejects(() => service.saveProfile({ profileName: '잘못된 선택', speakerUuid: 'dynamic-speaker-uuid', styleId: 999 }),
    (error: unknown) => error instanceof VoicevoxError && error.code === 'VOICE_SELECTION_MISSING');
  assert.equal(repository.loadProfile()?.styleId, 19);
  assert.equal(listed, 3);
});

test('audio_query applies only validated overrides and synthesis uses the selected style ID', async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = new VoicevoxClient({ fetch: mock((url, init) => {
    calls.push({ url, init });
    if (url.pathname === '/audio_query') return Response.json({ ...audioQuery, speedScale: 0.95 });
    return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } });
  }) });
  const query = await client.audioQuery('테스트 문장입니다.', 19, { speedScale: 1.2, volumeScale: 1.1 });
  assert.equal(query.speedScale, 1.2);
  assert.equal(query.pitchScale, 0);
  const audio = await client.synthesis(19, query);
  assert.deepEqual(audio, wav);
  assert.equal(calls[0]!.url.searchParams.get('speaker'), '19');
  assert.equal(calls[0]!.url.searchParams.get('text'), '테스트 문장입니다.');
  assert.equal(calls[1]!.url.searchParams.get('speaker'), '19');
  assert.equal(calls[1]!.init.method, 'POST');
  assert.equal(JSON.parse(String(calls[1]!.init.body)).speedScale, 1.2);
  await assert.rejects(() => client.audioQuery('문장', 19, { speedScale: 3 }), /Too big/);
  assert.equal(calls.length, 2);
});

test('sentence generation writes ordered WAV files and a reproducible manifest under output/tts', async t => {
  const projectRoot = root(t);
  const calls: string[] = [];
  const client = new VoicevoxClient({ fetch: mock((url, init) => {
    calls.push(`${init.method} ${url.pathname}?${url.searchParams.toString()}`);
    if (url.pathname === '/speakers') return Response.json(speakers);
    if (url.pathname === '/audio_query') return Response.json(audioQuery);
    return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } });
  }) });
  const repository = new VoicevoxRepository(projectRoot);
  const service = new VoicevoxService(client, repository);
  await service.saveProfile({ profileName: '기본', speakerUuid: 'dynamic-speaker-uuid', styleId: 7,
    parameters: { speedScale: 1.05, volumeScale: 1 },
  });
  const result = await service.generate({ contentId: 'episode_001', sentences: [
    { id: 'hook', text: '첫 문장입니다.' },
    { id: 'explain', text: '두 번째 문장입니다.', parameters: { speedScale: 0.9 } },
  ] });
  assert.equal(result.manifestPath, 'output/tts/episode_001/tts_manifest.json');
  assert.deepEqual(result.manifest.sentences.map(item => [item.order, item.id, item.fileName]), [
    [1, 'hook', '001_hook.wav'], [2, 'explain', '002_explain.wav'],
  ]);
  assert.equal((result.manifest.sentences[1]!.parameters as { speedScale: number }).speedScale, 0.9);
  assert.equal((result.manifest.sentences[1]!.audioQuery as { speedScale: number }).speedScale, 0.9);
  const disk = JSON.parse(readFileSync(join(projectRoot, result.manifestPath), 'utf8'));
  assert.deepEqual(disk, result.manifest);
  assert.ok(existsSync(join(projectRoot, 'output', 'tts', 'episode_001', '001_hook.wav')));
  assert.deepEqual(calls.map(call => call.split('?')[0]), [
    'GET /speakers', 'GET /speakers', 'POST /audio_query', 'POST /synthesis', 'POST /audio_query', 'POST /synthesis',
  ]);
  await assert.rejects(() => service.generate({ contentId: '../escape', sentences: [{ id: 'x', text: '문장' }] }));
  await assert.rejects(() => service.generate({ contentId: 'episode_001', sentences: [{ id: 'x', text: '문장' }] }),
    (error: unknown) => error instanceof VoicevoxError && error.code === 'TTS_OUTPUT_EXISTS');
});

test('generation failure returns a structured error and preserves profile, script order and completed output', async t => {
  const projectRoot = root(t);
  let syntheses = 0;
  const client = new VoicevoxClient({ fetch: mock((url) => {
    if (url.pathname === '/speakers') return Response.json(speakers);
    if (url.pathname === '/audio_query') return Response.json(audioQuery);
    syntheses += 1;
    return syntheses === 1 ? new Response(wav) : new Response('engine detail must not leak', { status: 500 });
  }) });
  const repository = new VoicevoxRepository(projectRoot);
  const service = new VoicevoxService(client, repository);
  await service.saveProfile({ profileName: '보존', speakerUuid: 'dynamic-speaker-uuid', styleId: 7 });
  await assert.rejects(() => service.generate({ contentId: 'failed_episode', sentences: [
    { id: 'one', text: '첫 문장' }, { id: 'two', text: '둘째 문장' },
  ] }), (error: unknown) => error instanceof VoicevoxError && error.code === 'ENGINE_HTTP_ERROR' && error.engineStatus === 500);
  const failed = JSON.parse(readFileSync(join(projectRoot, 'output', 'tts', 'failed_episode', 'tts_manifest.failed.json'), 'utf8'));
  assert.deepEqual(failed.sentences.map((item: { id: string }) => item.id), ['one', 'two']);
  assert.deepEqual(failed.completed.map((item: { id: string }) => item.id), ['one']);
  assert.equal(failed.profile.profileName, '보존');
  assert.equal(failed.error.engineStatus, 500);
  assert.doesNotMatch(JSON.stringify(failed), /engine detail/);
  assert.equal(repository.loadProfile()?.profileName, '보존');
});

test('VOICEVOX HTTP API exposes health, speakers, profile and explicit query/WAV endpoints with structured errors', async t => {
  const projectRoot = root(t);
  let speakersFail = false;
  const client = new VoicevoxClient({ fetch: mock((url) => {
    if (url.pathname === '/version') return Response.json('mock-version');
    if (url.pathname === '/speakers') return speakersFail ? new Response('private engine detail', { status: 500 }) : Response.json(speakers);
    if (url.pathname === '/audio_query') return Response.json(audioQuery);
    if (url.pathname === '/synthesis') return new Response(wav);
    return new Response(null, { status: 404 });
  }) });
  const service = new VoicevoxService(client, new VoicevoxRepository(projectRoot));
  const source = new SourceRepository(':memory:');
  const server = createAppServer({ repository: source, root: projectRoot, youtube: null, voicevoxRoute: createVoicevoxRoute(service) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); source.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const json = (path: string, method = 'GET', body?: unknown) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await (await json('/api/voicevox/health')).json()).data.status, 'success');
  assert.equal((await (await json('/api/voicevox/speakers')).json()).data.voices[0].styleId, 7);
  assert.equal((await (await json('/api/voicevox/profile')).json()).data, null);
  const profile = await json('/api/voicevox/profile', 'PUT', { profileName: 'HTTP 기본', speakerUuid: 'dynamic-speaker-uuid', styleId: 19 });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).data.styleName, '차분함');
  const preview = await json('/api/voicevox/preview', 'POST', { text: '미리듣기', styleId: 19 });
  assert.equal(preview.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), wav);

  const queryResponse = await json('/api/voicevox/audio-query', 'POST', { text: '명시적 쿼리', styleId: 19,
    parameters: { speedScale: 1.1 },
  });
  const query = (await queryResponse.json()).data;
  assert.equal(query.speedScale, 1.1);
  const synthesis = await json('/api/voicevox/synthesis', 'POST', { styleId: 19, audioQuery: query });
  assert.equal(synthesis.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await synthesis.arrayBuffer()), wav);

  const generation = await json('/api/voicevox/generations', 'POST', { contentId: 'http_episode', sentences: [
    { id: 'hook', text: '첫 번째 문장입니다.' }, { id: 'body', text: '두 번째 문장입니다.', parameters: { speedScale: 0.9 } },
  ] });
  assert.equal(generation.status, 201);
  const generated = (await generation.json()).data;
  assert.equal(generated.manifestPath, 'output/tts/http_episode/tts_manifest.json');
  assert.deepEqual(generated.manifest.sentences.map((item: { id: string }) => item.id), ['hook', 'body']);
  const collision = await json('/api/voicevox/generations', 'POST', { contentId: 'http_episode', sentences: [{ id: 'hook', text: '다시 생성' }] });
  assert.equal(collision.status, 409);
  assert.equal((await collision.json()).error.code, 'TTS_OUTPUT_EXISTS');

  speakersFail = true;
  const structured = await json('/api/voicevox/speakers');
  assert.equal(structured.status, 502);
  assert.deepEqual((await structured.json()).error, {
    code: 'ENGINE_HTTP_ERROR', message: 'VOICEVOX 요청이 HTTP 500로 실패했습니다.', kind: 'http', retriable: true, engineStatus: 500,
  });

  const failingService = new VoicevoxService(new VoicevoxClient({ fetch: mock(() => { throw new Error('private detail'); }) }), new VoicevoxRepository(root(t)));
  let failure: VoicevoxError | undefined;
  try { await failingService.listSpeakers(); }
  catch (error) { if (error instanceof VoicevoxError) failure = error; else throw error; }
  assert.ok(failure);
  assert.deepEqual(failure.toJSON(), { code: 'ENGINE_UNAVAILABLE', message: 'VOICEVOX Engine에 연결할 수 없습니다.', kind: 'unavailable', retriable: true });
});
