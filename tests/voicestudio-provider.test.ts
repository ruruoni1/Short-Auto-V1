import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStudioProvider } from '../src/app/voicestudio/provider.js';

const wav = new TextEncoder().encode('RIFFxxxxWAVEvoice');

test('VoiceStudio provider maps flexible voice list payloads', async () => {
  const provider = new VoiceStudioProvider({
    health: async () => ({ endpoint: 'http://127.0.0.1:3900', state: 'ready' as const }),
    listVoices: async () => ({ voices: [{ voice_id: 'jp-1', voice_name: 'Japanese Voice', language: 'ja' }, { id: 2, name: 'Second' }] }),
  } as never);
  assert.deepEqual(await provider.listVoices(), [
    { id: 'jp-1', name: 'Japanese Voice', language: 'ja', metadata: { voice_id: 'jp-1', voice_name: 'Japanese Voice', language: 'ja' } },
    { id: '2', name: 'Second', metadata: { id: 2, name: 'Second' } },
  ]);
});

test('VoiceStudio provider reports status and synthesizes through OpenAI-compatible request', async () => {
  let request: unknown;
  const provider = new VoiceStudioProvider({
    health: async () => ({ endpoint: 'http://127.0.0.1:3900', state: 'ready' as const, version: '0.5.3' }),
    listVoices: async () => [],
    synthesize: async (input: Record<string, unknown>) => { request = input; return wav; },
  } as never);
  assert.equal(await provider.isAvailable(), true);
  assert.deepEqual(await provider.getStatus(), { provider: 'voicestudio', displayName: 'VoiceStudio', state: 'ready', version: '0.5.3' });
  const result = await provider.synthesize({ text: '테스트', voiceId: 'jp-1', language: 'ja', speed: 1.1, providerOptions: { model: 'voxcp m2' } });
  assert.deepEqual(request, { model: 'voxcp m2', voice: 'jp-1', input: '테스트', response_format: 'wav', language: 'ja', speed: 1.1 });
  assert.deepEqual(result.audio, wav);
  assert.equal(result.engine, 'voxcp m2');
});

test('VoiceStudio provider requires a voice selection', async () => {
  const provider = new VoiceStudioProvider({ synthesize: async () => wav } as never);
  await assert.rejects(() => provider.synthesize({ text: '테스트' }), /VOICE_REQUIRED/);
});
