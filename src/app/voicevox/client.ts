import { z } from 'zod';
import {
  AudioQueryInputSchema,
  VoicevoxAudioQuerySchema,
  VoiceParametersSchema,
  VoicevoxError,
  VoicevoxSpeakerSchema,
  parseVoicevoxEndpoint,
  type VoiceParameters,
  type VoicevoxSpeaker,
} from './models.js';

const MAX_WAV_BYTES = 100 * 1024 * 1024;

export interface VoicevoxClientOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class VoicevoxClient {
  readonly endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: VoicevoxClientOptions = {}) {
    this.endpoint = parseVoicevoxEndpoint(options.endpoint).origin;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = z.number().int().min(100).max(60_000).parse(options.timeoutMs ?? 5_000);
  }

  async health(): Promise<
    | { status: 'success'; endpoint: string; version: string }
    | { status: 'unavailable'; endpoint: string; error: ReturnType<VoicevoxError['toJSON']> }
    | { status: 'error'; endpoint: string; error: ReturnType<VoicevoxError['toJSON']> }
  > {
    try {
      const response = await this.#request('/version', { method: 'GET' });
      const version = await response.json().catch(() => null) as unknown;
      if (typeof version !== 'string' || version.length === 0 || version.length > 200) {
        throw new VoicevoxError('INVALID_VERSION_RESPONSE', 'VOICEVOX 버전 응답이 올바르지 않습니다.', 'invalid_response', 502, true);
      }
      return { status: 'success', endpoint: this.endpoint, version };
    } catch (error) {
      const known = this.#known(error);
      return { status: known.kind === 'unavailable' ? 'unavailable' : 'error', endpoint: this.endpoint, error: known.toJSON() };
    }
  }

  async speakers(): Promise<VoicevoxSpeaker[]> {
    const response = await this.#request('/speakers', { method: 'GET' });
    const data = await response.json().catch(() => null) as unknown;
    const parsed = z.array(VoicevoxSpeakerSchema).safeParse(data);
    if (!parsed.success || parsed.data.length === 0) {
      throw new VoicevoxError('INVALID_SPEAKERS_RESPONSE', 'VOICEVOX 화자 목록 응답이 올바르지 않습니다.', 'invalid_response', 502, true);
    }
    const identities = new Set<string>();
    for (const speaker of parsed.data) for (const style of speaker.styles) {
      const key = `${speaker.speaker_uuid}\0${style.id}`;
      if (identities.has(key)) throw new VoicevoxError('DUPLICATE_VOICE_STYLE', 'VOICEVOX 화자 목록에 중복된 스타일이 있습니다.', 'invalid_response', 502, true);
      identities.add(key);
    }
    return parsed.data;
  }

  async audioQuery(text: string, styleId: number, parameters: VoiceParameters = {}): Promise<Record<string, unknown>> {
    const input = AudioQueryInputSchema.parse({ text, styleId, parameters });
    const url = new URL('/audio_query', this.endpoint);
    url.searchParams.set('text', input.text);
    url.searchParams.set('speaker', String(input.styleId));
    const response = await this.#request(url, { method: 'POST' });
    const query = await response.json().catch(() => null) as unknown;
    const parsedQuery = VoicevoxAudioQuerySchema.safeParse(query);
    if (!parsedQuery.success) throw new VoicevoxError('INVALID_AUDIO_QUERY_RESPONSE', 'VOICEVOX 음성 쿼리 응답이 올바르지 않습니다.', 'invalid_response', 502, true);
    return { ...parsedQuery.data, ...VoiceParametersSchema.parse(input.parameters) };
  }

  async synthesis(styleId: number, audioQuery: Record<string, unknown>): Promise<Buffer> {
    z.number().int().nonnegative().parse(styleId);
    if (!object(audioQuery)) throw new VoicevoxError('INVALID_AUDIO_QUERY', '합성할 음성 쿼리가 올바르지 않습니다.', 'invalid_response', 400, false);
    const url = new URL('/synthesis', this.endpoint);
    url.searchParams.set('speaker', String(styleId));
    const bytes = await this.#requestBytes(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audioQuery) }, MAX_WAV_BYTES);
    if (bytes.length < 12 || bytes.length > MAX_WAV_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
      throw new VoicevoxError('INVALID_WAV_RESPONSE', 'VOICEVOX 합성 응답이 WAV 형식이 아닙니다.', 'invalid_response', 502, true);
    }
    return bytes;
  }

  async #requestBytes(url: URL, init: RequestInit, limit: number): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new VoicevoxError('ENGINE_HTTP_ERROR', `VOICEVOX 요청이 HTTP ${response.status}로 실패했습니다.`, 'http', 502, response.status >= 500, response.status);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(declared) && declared > limit) throw new VoicevoxError('WAV_TOO_LARGE', 'VOICEVOX 음성 응답이 너무 큽니다.', 'invalid_response', 502, true);
      if (!response.body) return Buffer.alloc(0);
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new VoicevoxError('WAV_TOO_LARGE', 'VOICEVOX 음성 응답이 너무 큽니다.', 'invalid_response', 502, true);
        }
        chunks.push(Buffer.from(part.value));
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof VoicevoxError) throw error;
      throw new VoicevoxError(controller.signal.aborted ? 'ENGINE_TIMEOUT' : 'ENGINE_UNAVAILABLE',
        controller.signal.aborted ? 'VOICEVOX 연결 시간이 초과되었습니다.' : 'VOICEVOX Engine에 연결할 수 없습니다.',
        'unavailable', 503, true);
    } finally { clearTimeout(timer); }
  }

  async #request(path: string | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(path instanceof URL ? path : new URL(path, this.endpoint), { ...init, signal: controller.signal });
      if (!response.ok) throw new VoicevoxError('ENGINE_HTTP_ERROR', `VOICEVOX 요청이 HTTP ${response.status}로 실패했습니다.`, 'http', 502, response.status >= 500, response.status);
      return response;
    } catch (error) {
      if (error instanceof VoicevoxError) throw error;
      const message = controller.signal.aborted ? 'VOICEVOX 연결 시간이 초과되었습니다.' : 'VOICEVOX Engine에 연결할 수 없습니다.';
      throw new VoicevoxError(controller.signal.aborted ? 'ENGINE_TIMEOUT' : 'ENGINE_UNAVAILABLE', message, 'unavailable', 503, true);
    } finally { clearTimeout(timer); }
  }

  #known(error: unknown): VoicevoxError {
    return error instanceof VoicevoxError ? error
      : new VoicevoxError('ENGINE_UNAVAILABLE', 'VOICEVOX Engine에 연결할 수 없습니다.', 'unavailable', 503, true);
  }
}
