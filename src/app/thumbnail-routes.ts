import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ThumbnailRepository } from './thumbnails/repository.js';
import { FontRegistry } from './fonts/registry.js';
import { SourceFrameReferenceSchema } from './thumbnails/models.js';

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;
type SendJson = (res: ServerResponse, status: number, value: unknown) => void;
const binaryInput = z.object({
  expectedRevision: z.number().int().nonnegative(),
  dataBase64: z.string().max(28_000_000),
  sourceType: z.enum(['AI_GENERATED','USER_IMAGE','RECREATED_IMAGE','OFFICIAL_CLIP_FRAME']).optional(),
  sourceFrame: SourceFrameReferenceSchema.optional(),
  format: z.enum(['png','jpeg']).optional(),
}).strict();
function decode(value: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw Object.assign(new Error('이미지 인코딩을 확인하세요.'), { status:400, code:'INVALID_IMAGE' });
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length > 20 * 1024 * 1024) {
    throw Object.assign(new Error('이미지는 20MB 이하여야 합니다.'), { status:400, code:'INVALID_IMAGE' });
  }
  return bytes;
}
export async function routeThumbnails(repo: ThumbnailRepository, req: IncomingMessage, res: ServerResponse,
  path: string, method: string, body: ReadBody, json: SendJson, fonts: FontRegistry): Promise<boolean> {
  if (fonts.serve(path, method, res)) return true;
  if (method === 'GET' && path === '/api/thumbnail-templates') { json(res,200,{data:repo.listTemplates()}); return true; }
  if (method === 'GET' && path === '/api/font-registry') { json(res,200,{data:fonts.listFonts()}); return true; }
  if (path === '/api/thumbnail-projects') {
    if (method === 'GET') { json(res,200,{data:repo.listProjects()}); return true; }
    if (method === 'POST') { json(res,201,{data:repo.createProject(await body(req))}); return true; }
  }
  const match = path.match(/^\/api\/thumbnail-projects\/([^/]+)(?:\/(assets|exports)(?:\/([^/]+))?)?$/);
  if (!match) return false;
  const id = match[1]!;
  if (!match[2]) {
    if (method === 'GET') { json(res,200,{data:repo.getProject(id)}); return true; }
    if (method === 'PATCH') { json(res,200,{data:repo.updateProject(id,await body(req))}); return true; }
    if (method === 'DELETE') { repo.deleteProject(id,await body(req)); json(res,200,{data:{deleted:true}}); return true; }
  }
  if (match[3] && method === 'GET') {
    const file = match[2] === 'assets' ? repo.getAsset(id,match[3]) : repo.getExport(id,match[3]);
    res.writeHead(200,{'Content-Type':file.mimeType,'Cache-Control':'no-store'}); res.end(file.bytes); return true;
  }
  if (match[2] && !match[3] && method === 'POST') {
    const input = binaryInput.parse(await body(req,28_100_000));
    const bytes = decode(input.dataBase64);
    if (match[2] === 'assets') {
      if (!input.sourceType || input.format) throw Object.assign(new Error('이미지 소스 유형을 확인하세요.'),{status:400});
      const result = repo.uploadBaseImage(id,{expectedRevision:input.expectedRevision,sourceType:input.sourceType,bytes,
        ...(input.sourceFrame ? { sourceFrame: input.sourceFrame } : {})});
      json(res,201,{data:result});
    } else {
      if (!input.format || input.sourceType || input.sourceFrame) throw Object.assign(new Error('출력 형식을 확인하세요.'),{status:400});
      const result = repo.storeExport(id,{expectedRevision:input.expectedRevision,format:input.format,bytes});
      json(res,201,{data:result});
    }
    return true;
  }
  return false;
}
