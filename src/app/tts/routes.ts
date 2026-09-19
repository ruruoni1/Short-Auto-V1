import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AppRoute } from '../server.js';
import { TTSProviderRegistry } from './registry.js';

const SynthesisInputSchema = z.strictObject({
  text: z.string().min(1).max(5_000),
  language: z.string().min(1).max(32).optional(),
  voiceId: z.string().min(1).max(200).optional(),
  speed: z.number().finite().min(0.5).max(2).optional(),
  style: z.string().min(1).max(200).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});

function providerId(path: string): string | undefined {
  const match = path.match(/^\/api\/tts\/providers\/([^/]+)(?:\/voices|\/synthesize)?$/);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]!); } catch { return undefined; }
}

function errorResponse(error: unknown): { status: number; error: { code: string; message: string; [key: string]: unknown } } {
  const known = error as { status?: unknown; code?: unknown; message?: unknown; toJSON?: () => unknown };
  const status = typeof known.status === 'number' && known.status >= 400 && known.status <= 599 ? known.status : 502;
  const detail = typeof known.toJSON === 'function' ? known.toJSON() : null;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return { status, error: detail as { code: string; message: string; [key: string]: unknown } };
  }
  return {
    status,
    error: {
      code: typeof known.code === 'string' ? known.code : 'TTS_PROVIDER_FAILED',
      message: status < 500 && typeof known.message === 'string' ? known.message : 'TTS provider 요청을 처리하지 못했습니다.',
    },
  };
}

export function createTTSRoute(registry: TTSProviderRegistry): AppRoute {
  return async (req: IncomingMessage, res: ServerResponse, path, method, body, json): Promise<boolean> => {
    if (!path.startsWith('/api/tts')) return false;
    try {
      if (path === '/api/tts/providers' && method === 'GET') {
        const providers = await Promise.all(registry.list().map(async provider => {
          try { return await provider.getStatus(); }
          catch (error) {
            const detail = errorResponse(error).error;
            return { provider: provider.id, displayName: provider.displayName, state: 'error' as const,
              error: { code: detail.code, message: detail.message } };
          }
        }));
        json(res, 200, { data: providers }); return true;
      }

      const id = providerId(path);
      if (!id) { json(res, 404, { error: { code: 'NOT_FOUND', message: '요청한 TTS 경로가 없습니다.' } }); return true; }
      let provider;
      try { provider = registry.get(id); }
      catch { json(res, 404, { error: { code: 'TTS_PROVIDER_NOT_FOUND', message: 'TTS provider를 찾을 수 없습니다.' } }); return true; }

      if (path.endsWith('/voices') && method === 'GET') {
        json(res, 200, { data: await provider.listVoices() }); return true;
      }
      if (path.endsWith('/synthesize') && method === 'POST') {
        const input = SynthesisInputSchema.parse(await body(req));
        const request = {
          text: input.text,
          ...(input.language ? { language: input.language } : {}),
          ...(input.voiceId ? { voiceId: input.voiceId } : {}),
          ...(input.speed === undefined ? {} : { speed: input.speed }),
          ...(input.style ? { style: input.style } : {}),
          ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
        };
        const result = await provider.synthesize(request);
        const audio = Buffer.from(result.audio);
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': audio.length,
          'Cache-Control': 'no-store',
          'X-TTS-Provider': result.provider,
          ...(result.engine ? { 'X-TTS-Engine': result.engine } : {}),
        });
        res.end(audio); return true;
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: '요청한 TTS 경로가 없습니다.' } }); return true;
    } catch (error) {
      if (error instanceof z.ZodError) { json(res, 400, { error: { code: 'INVALID_INPUT', message: '입력값을 확인하세요.' } }); return true; }
      const response = errorResponse(error);
      json(res, response.status, response);
      return true;
    }
  };
}
