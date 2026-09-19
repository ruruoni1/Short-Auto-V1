import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TTSProvider, TTSProviderStatus, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from '../tts/types.js';
import { VoiceStudioClient } from './client.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function voiceItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (object(payload) && Array.isArray(payload.voices)) return payload.voices;
  return [];
}

export class VoiceStudioProvider implements TTSProvider {
  readonly id = 'voicestudio';
  readonly displayName = 'VoiceStudio';

  constructor(readonly client: VoiceStudioClient) {}

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).state === 'ready';
  }

  async getStatus(): Promise<TTSProviderStatus> {
    const health = await this.client.health();
    return {
      provider: this.id,
      displayName: this.displayName,
      state: health.state,
      ...(health.version ? { version: health.version } : {}),
      ...(health.error ? { error: { code: health.error.code, message: health.error.message } } : {}),
      ...(health.payload !== undefined ? { metadata: { health: health.payload } } : {}),
    };
  }

  async listVoices(): Promise<TTSVoice[]> {
    return voiceItems(await this.client.listVoices()).flatMap(item => {
      if (!object(item)) return [];
      const id = item.id ?? item.voice_id ?? item.voiceId;
      const name = item.name ?? item.voice_name ?? item.voiceName;
      if ((typeof id !== 'string' && typeof id !== 'number') || typeof name !== 'string' || name.length === 0) return [];
      const language = typeof item.language === 'string' ? item.language : typeof item.lang === 'string' ? item.lang : undefined;
      return [{
        id: String(id),
        name,
        ...(language ? { language } : {}),
        metadata: item,
      }];
    });
  }

  async synthesize(request: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    if (!request.voiceId) throw new Error('VOICE_REQUIRED');
    const options = request.providerOptions ?? {};
    const requestedModel = typeof options.model === 'string' && options.model.length > 0 ? options.model : 'default';
    // VoiceStudio's OpenAI-compatible endpoint accepts concrete engine IDs (or
    // tts-1/tts-1-hd aliases), but not the UI-facing `default` label.
    const model = requestedModel === 'default' ? 'omnivoice' : requestedModel;
    const input: Record<string, unknown> = {
      model,
      voice: request.voiceId,
      input: request.text,
      response_format: 'wav',
      ...(request.language ? { language: request.language } : {}),
      ...(request.speed === undefined ? {} : { speed: request.speed }),
      ...(request.style ? { style: request.style } : {}),
    };
    const audio = await this.client.synthesize(input);
    if (request.outputPath) {
      await mkdir(dirname(request.outputPath), { recursive: true });
      await writeFile(request.outputPath, audio);
    }
    return {
      provider: this.id,
      engine: model,
      audio,
      ...(request.outputPath ? { outputPath: request.outputPath } : {}),
      metadata: { voiceId: request.voiceId, language: request.language ?? null },
    };
  }
}
