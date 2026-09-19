import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TTSProviderRegistry } from '../src/app/tts/registry.js';
import { VoicevoxProvider } from '../src/app/voicevox/provider.js';

const wav = Buffer.from('RIFF-test-WAVE');

function service(overrides: Record<string, unknown> = {}) {
  return {
    health: async () => ({ status: 'success' as const, endpoint: 'http://127.0.0.1:50021', version: '0.25.2' }),
    listSpeakers: async () => ({ speakers: [], voices: [{ speakerUuid: 'speaker-1', speakerName: '테스트', styleId: 3, styleName: '노말' }] }),
    preview: async () => wav,
    ...overrides,
  } as never;
}

test('TTS provider registry registers and resolves providers', () => {
  const registry = new TTSProviderRegistry();
  const provider = new VoicevoxProvider(service());
  registry.register(provider);
  assert.equal(registry.has('voicevox'), true);
  assert.equal(registry.get('voicevox'), provider);
  assert.throws(() => registry.register(provider), /already registered/);
});

test('Voicevox provider maps health and dynamic voice identity', async () => {
  const provider = new VoicevoxProvider(service());
  assert.equal(await provider.isAvailable(), true);
  assert.deepEqual(await provider.getStatus(), {
    provider: 'voicevox', displayName: 'VOICEVOX', state: 'ready', version: '0.25.2',
  });
  assert.deepEqual(await provider.listVoices(), [{
    id: '3', name: '테스트 · 노말', language: 'ja', metadata: { speakerUuid: 'speaker-1', styleId: 3 },
  }]);
});

test('Voicevox provider synthesizes with selected style and writes optional output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'short-auto-tts-provider-'));
  const outputPath = join(root, 'nested', 'voice.wav');
  let received: unknown;
  const provider = new VoicevoxProvider(service({ preview: async (_text: string, id: number, parameters: unknown) => {
    received = { id, parameters };
    return wav;
  }}));
  const result = await provider.synthesize({ text: '테스트', voiceId: '3', speed: 1.1, outputPath });
  assert.deepEqual(received, { id: 3, parameters: { speedScale: 1.1 } });
  assert.equal(result.provider, 'voicevox');
  assert.equal(result.outputPath, outputPath);
  assert.deepEqual(Buffer.from(result.audio), wav);
  assert.deepEqual(await readFile(outputPath), wav);
});

test('Voicevox provider rejects missing or malformed voice selection', async () => {
  const provider = new VoicevoxProvider(service());
  await assert.rejects(() => provider.synthesize({ text: '테스트' }), /VOICE_REQUIRED/);
  await assert.rejects(() => provider.synthesize({ text: '테스트', voiceId: 'x' }), /VOICE_REQUIRED/);
});
