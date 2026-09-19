import { z } from 'zod';
import {
  DEFAULT_VOICESTUDIO_ENDPOINT,
  parseVoiceStudioEndpoint,
  VoiceStudioError,
  type VoiceStudioHealth,
} from './models.js';

export interface VoiceStudioClientOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  synthesisTimeoutMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statusValue(payload: unknown): string | undefined {
  if (!object(payload)) return undefined;
  for (const key of ['status', 'state', 'phase']) {
    const value = payload[key];
    if (typeof value === 'string') return value.toLowerCase();
  }
  return undefined;
}

function versionValue(payload: unknown): string | undefined {
  if (!object(payload)) return undefined;
  for (const key of ['version', 'app_version', 'engine_version']) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value;
  }
  return undefined;
}

export class VoiceStudioClient {
  readonly endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #synthesisTimeoutMs: number;

  constructor(options: VoiceStudioClientOptions = {}) {
    this.endpoint = parseVoiceStudioEndpoint(options.endpoint ?? DEFAULT_VOICESTUDIO_ENDPOINT).origin;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = z.number().int().min(100).max(300_000).parse(options.timeoutMs ?? 5_000);
    this.#synthesisTimeoutMs = z.number().int().min(100).max(600_000).parse(options.synthesisTimeoutMs ?? 120_000);
  }

  async health(): Promise<VoiceStudioHealth> {
    try {
      const response = await this.#request('/health');
      const payload = await response.json().catch(() => null) as unknown;
      const status = statusValue(payload);
      const state = status === 'starting' || status === 'loading' || status === 'initializing'
        ? 'starting' : status === 'error' || status === 'unavailable' ? 'error' : 'ready';
      const version = versionValue(payload);
      return {
        endpoint: this.endpoint,
        state,
        payload,
        ...(version ? { version } : {}),
      };
    } catch (error) {
      const known = error instanceof VoiceStudioError ? error
        : new VoiceStudioError('BACKEND_UNAVAILABLE', 'VoiceStudio backend에 연결할 수 없습니다.', 'unavailable', 503, true);
      return { endpoint: this.endpoint, state: 'unavailable', error: known.toJSON() };
    }
  }

  async systemInfo(): Promise<unknown> {
    const response = await this.#request('/system/info');
    return response.json().catch(() => null);
  }

  async listVoices(): Promise<unknown> {
    const response = await this.#request('/v1/audio/voices');
    return response.json().catch(() => null);
  }

  async listEngines(): Promise<unknown> {
    const response = await this.#request('/engines');
    return response.json().catch(() => null);
  }

  async synthesize(input: Record<string, unknown>): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#synthesisTimeoutMs);
    try {
      const response = await this.#fetch(new URL('/v1/audio/speech', this.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) throw new VoiceStudioError(
        'SYNTHESIS_HTTP_ERROR',
        `VoiceStudio synthesis 요청이 HTTP ${response.status}로 실패했습니다.`,
        'http',
        502,
        response.status >= 500,
        response.status,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') {
        throw new VoiceStudioError('INVALID_WAV_RESPONSE', 'VoiceStudio synthesis 응답이 WAV 형식이 아닙니다.', 'invalid_response', 502, true);
      }
      return bytes;
    } catch (error) {
      if (error instanceof VoiceStudioError) throw error;
      throw new VoiceStudioError(
        controller.signal.aborted ? 'SYNTHESIS_TIMEOUT' : 'SYNTHESIS_UNAVAILABLE',
        controller.signal.aborted ? 'VoiceStudio synthesis 시간이 초과되었습니다.' : 'VoiceStudio synthesis에 연결할 수 없습니다.',
        'unavailable',
        503,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async #request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(new URL(path, this.endpoint), { method: 'GET', signal: controller.signal });
      if (!response.ok) throw new VoiceStudioError(
        'BACKEND_HTTP_ERROR',
        `VoiceStudio 요청이 HTTP ${response.status}로 실패했습니다.`,
        'http',
        502,
        response.status >= 500,
        response.status,
      );
      return response;
    } catch (error) {
      if (error instanceof VoiceStudioError) throw error;
      throw new VoiceStudioError(
        controller.signal.aborted ? 'BACKEND_TIMEOUT' : 'BACKEND_UNAVAILABLE',
        controller.signal.aborted ? 'VoiceStudio 연결 시간이 초과되었습니다.' : 'VoiceStudio backend에 연결할 수 없습니다.',
        'unavailable',
        503,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
