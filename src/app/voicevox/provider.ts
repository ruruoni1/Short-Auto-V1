import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VoiceParametersSchema, type VoiceParameters } from './models.js';
import type { VoicevoxService } from './service.js';
import type { TTSProvider, TTSProviderStatus, TTSSynthesisRequest, TTSSynthesisResult, TTSVoice } from '../tts/types.js';

type VoicevoxProviderService = Pick<VoicevoxService, 'health' | 'listSpeakers' | 'preview'>;

function providerParameters(request: TTSSynthesisRequest): VoiceParameters {
  const options = request.providerOptions?.voicevoxParameters;
  const parameters = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  return VoiceParametersSchema.parse({
    ...parameters,
    ...(request.speed === undefined ? {} : { speedScale: request.speed }),
  });
}

function styleId(request: TTSSynthesisRequest): number {
  if (!request.voiceId || !/^\d+$/.test(request.voiceId)) throw new Error('VOICE_REQUIRED');
  const value = Number(request.voiceId);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('VOICE_INVALID');
  return value;
}

export class VoicevoxProvider implements TTSProvider {
  readonly id = 'voicevox';
  readonly displayName = 'VOICEVOX';

  constructor(readonly service: VoicevoxProviderService) {}

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).state === 'ready';
  }

  async getStatus(): Promise<TTSProviderStatus> {
    const health = await this.service.health();
    if (health.status === 'success') return {
      provider: this.id,
      displayName: this.displayName,
      state: 'ready',
      version: health.version,
    };
    return {
      provider: this.id,
      displayName: this.displayName,
      state: health.status === 'unavailable' ? 'unavailable' : 'error',
      error: { code: health.error.code, message: health.error.message },
    };
  }

  async listVoices(): Promise<TTSVoice[]> {
    const result = await this.service.listSpeakers();
    return result.voices.map(voice => ({
      id: String(voice.styleId),
      name: `${voice.speakerName} · ${voice.styleName}`,
      language: 'ja',
      metadata: { speakerUuid: voice.speakerUuid, styleId: voice.styleId },
    }));
  }

  async synthesize(request: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const id = styleId(request);
    const audio = await this.service.preview(request.text, id, providerParameters(request));
    if (request.outputPath) {
      await mkdir(dirname(request.outputPath), { recursive: true });
      await writeFile(request.outputPath, audio);
    }
    return {
      provider: this.id,
      engine: this.id,
      audio,
      ...(request.outputPath ? { outputPath: request.outputPath } : {}),
      metadata: { styleId: id, language: request.language ?? 'ja' },
    };
  }
}
