import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AppRoute } from '../server.js';
import { AudioQueryInputSchema, VoiceParametersSchema, VoicevoxAudioQuerySchema, VoicevoxError } from './models.js';
import { VoicevoxService } from './service.js';

const SynthesisInputSchema = z.strictObject({
  styleId: z.number().int().nonnegative(),
  audioQuery: VoicevoxAudioQuerySchema,
});
const PreviewInputSchema = AudioQueryInputSchema;

export function createVoicevoxRoute(service: VoicevoxService): AppRoute {
  return async (req: IncomingMessage, res: ServerResponse, path, method, body, json): Promise<boolean> => {
    if (!path.startsWith('/api/voicevox')) return false;
    try {
      if (path === '/api/voicevox/health' && method === 'GET') {
        json(res, 200, { data: await service.health() }); return true;
      }
      if (path === '/api/voicevox/speakers' && method === 'GET') {
        json(res, 200, { data: await service.listSpeakers() }); return true;
      }
      if (path === '/api/voicevox/profile') {
        if (method === 'GET') { json(res, 200, { data: service.loadProfile() }); return true; }
        if (method === 'PUT') { json(res, 200, { data: await service.saveProfile(await body(req)) }); return true; }
      }
      if (path === '/api/voicevox/audio-query' && method === 'POST') {
        const input = AudioQueryInputSchema.parse(await body(req));
        json(res, 200, { data: await service.createAudioQuery(input.text, input.styleId, input.parameters) }); return true;
      }
      if (path === '/api/voicevox/synthesis' && method === 'POST') {
        const input = SynthesisInputSchema.parse(await body(req));
        const wav = await service.synthesize(input.styleId, input.audioQuery);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
        res.end(wav); return true;
      }
      if (path === '/api/voicevox/preview' && method === 'POST') {
        const input = PreviewInputSchema.parse(await body(req));
        const wav = await service.preview(input.text, input.styleId, VoiceParametersSchema.parse(input.parameters));
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
        res.end(wav); return true;
      }
      if (path === '/api/voicevox/generations' && method === 'POST') {
        json(res, 201, { data: await service.generate(await body(req)) }); return true;
      }
      return false;
    } catch (error) {
      if (!(error instanceof VoicevoxError)) throw error;
      json(res, error.status, { error: error.toJSON() }); return true;
    }
  };
}
