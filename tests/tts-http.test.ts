import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRepository } from '../src/app/clips/repository.js';
import { createAppServer } from '../src/app/server.js';
import { TTSProviderRegistry } from '../src/app/tts/registry.js';
import { createTTSRoute } from '../src/app/tts/routes.js';
import type { TTSProvider, TTSSynthesisRequest } from '../src/app/tts/types.js';

const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);

class FakeProvider implements TTSProvider {
  readonly id = 'fake';
  readonly displayName = 'Fake TTS';
  requests: TTSSynthesisRequest[] = [];
  async isAvailable() { return true; }
  async getStatus() { return { provider: this.id, displayName: this.displayName, state: 'ready' as const, version: 'test' }; }
  async listVoices() { return [{ id: 'voice-1', name: '테스트 음성', language: 'ja' }]; }
  async synthesize(request: TTSSynthesisRequest) {
    this.requests.push(request);
    return { provider: this.id, engine: 'fake-engine', audio: wav };
  }
}

function root(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'short-auto-tts-http-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('generic TTS API lists providers, voices and returns WAV without allowing output paths', async t => {
  const fake = new FakeProvider();
  const registry = new TTSProviderRegistry();
  registry.register(fake);
  const source = new SourceRepository(':memory:');
  const server = createAppServer({ repository: source, root: root(t), youtube: null, ttsRoute: createTTSRoute(registry) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); source.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = 'GET', body?: unknown) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const providers = await request('/api/tts/providers');
  assert.equal(providers.status, 200);
  assert.deepEqual((await providers.json()).data[0], { provider: 'fake', displayName: 'Fake TTS', state: 'ready', version: 'test' });

  const voices = await request('/api/tts/providers/fake/voices');
  assert.equal(voices.status, 200);
  assert.equal((await voices.json()).data[0].id, 'voice-1');

  const synthesis = await request('/api/tts/providers/fake/synthesize', 'POST', {
    text: '합성 테스트', voiceId: 'voice-1', language: 'ja', speed: 1.1, outputPath: 'should-not-pass',
  });
  assert.equal(synthesis.status, 400);
  assert.equal((await synthesis.json()).error.code, 'INVALID_INPUT');
  assert.equal(fake.requests.length, 0);

  const valid = await request('/api/tts/providers/fake/synthesize', 'POST', {
    text: '합성 테스트', voiceId: 'voice-1', language: 'ja', speed: 1.1,
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get('content-type'), 'audio/wav');
  assert.equal(valid.headers.get('x-tts-provider'), 'fake');
  assert.deepEqual(Buffer.from(await valid.arrayBuffer()), wav);
  assert.deepEqual(fake.requests[0], { text: '합성 테스트', voiceId: 'voice-1', language: 'ja', speed: 1.1 });
});

test('generic TTS API returns structured provider and route errors', async t => {
  const registry = new TTSProviderRegistry();
  const source = new SourceRepository(':memory:');
  const server = createAppServer({ repository: source, root: root(t), youtube: null, ttsRoute: createTTSRoute(registry) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); source.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const missing = await fetch(`${base}/api/tts/providers/missing/voices`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'TTS_PROVIDER_NOT_FOUND');
  const unknown = await fetch(`${base}/api/tts/unknown`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
});

test('VoiceStudio installation API requires explicit consent and keeps paths server-owned', async t => {
  const registry = new TTSProviderRegistry();
  const source = new SourceRepository(':memory:');
  let resolveCalls = 0;
  let installCalls = 0;
  const location = { executablePath: 'C:\\Users\\tester\\AppData\\Local\\Programs\\VoiceStudio\\VoiceStudio.exe' };
  const server = createAppServer({ repository: source, root: root(t), youtube: null, ttsRoute: createTTSRoute(registry, {
    voiceStudioInstall: {
      installer: { resolveLatestStable: async () => {
        resolveCalls += 1;
        return { version: 'v0.5.3', installer: { name: 'VoiceStudio-Electron-0.5.3-win-x64.exe', url: 'https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/VoiceStudio-Electron-0.5.3-win-x64.exe', sha256: 'a'.repeat(64) }, checksumManifest: { name: 'SHA256SUMS-Windows.x64.txt', url: 'https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/SHA256SUMS-Windows.x64.txt' } };
      } },
      manager: { install: async () => {
        installCalls += 1;
        return { installer: { path: 'D:\\data\\installer.exe', bytes: 12, sha256: 'a'.repeat(64), downloaded: true }, installation: location };
      } },
      locator: { find: async () => location },
      targetDirectory: 'D:\\coding\\Short-auto\\data\\voicestudio\\installers',
    },
  }) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); source.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, body?: unknown) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const status = await fetch(`${base}/api/tts/providers/voicestudio/installation`);
  assert.deepEqual((await status.json()).data, { installed: true, executablePath: location.executablePath });
  const denied = await request('/api/tts/providers/voicestudio/install', { consent: false });
  assert.equal(denied.status, 400);
  assert.equal(resolveCalls, 0);
  assert.equal(installCalls, 0);
  const pathOverride = await request('/api/tts/providers/voicestudio/install', { consent: true, targetDirectory: 'C:\\unsafe' });
  assert.equal(pathOverride.status, 400);
  assert.equal(resolveCalls, 0);
  assert.equal(installCalls, 0);
  const installed = await request('/api/tts/providers/voicestudio/install', { consent: true });
  assert.equal(installed.status, 201);
  assert.deepEqual((await installed.json()).data.installation, { installed: true, executablePath: location.executablePath });
  assert.equal(resolveCalls, 1);
  assert.equal(installCalls, 1);
});
