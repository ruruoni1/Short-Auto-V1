import type { IncomingMessage, ServerResponse } from 'node:http';
import { ListSourceFramesQuerySchema } from './models.js';
import type { SourceFrameService } from './service.js';

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;
type SendJson = (res: ServerResponse, status: number, value: unknown) => void;

export function createSourceFrameRoute(service: SourceFrameService) {
  return async function routeSourceFrames(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    method: string,
    body: ReadBody,
    json: SendJson,
  ): Promise<boolean> {
    if (method === 'GET' && path === '/api/source-frames') {
      const url = new URL(req.url ?? path, `http://${req.headers.host ?? '127.0.0.1'}`);
      const query = ListSourceFramesQuerySchema.parse(Object.fromEntries(url.searchParams));
      json(res, 200, { data: service.listFrames(query) });
      return true;
    }
    const image = path.match(/^\/api\/source-frames\/([^/]+)\/image$/);
    if (method === 'GET' && image) {
      const result = service.getFrameImage(image[1]!);
      res.writeHead(200, {
        'Content-Type': result.frame.mimeType,
        'Content-Length': result.bytes.length,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(result.bytes);
      return true;
    }
    const frame = path.match(/^\/api\/source-frames\/([^/]+)$/);
    if (method === 'GET' && frame) {
      json(res, 200, { data: service.getFrame(frame[1]!) });
      return true;
    }
    const clip = path.match(/^\/api\/source-clips\/([^/]+)\/frames$/);
    if (method === 'POST' && clip) {
      const result = await service.createFrame(clip[1]!, await body(req));
      json(res, result.reused ? 200 : 201, { data: result.frame, meta: { reused: result.reused } });
      return true;
    }
    return false;
  };
}
