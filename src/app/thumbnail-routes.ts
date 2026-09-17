import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ThumbnailRepository, ThumbnailRepositoryError } from './thumbnails/repository.js';
import { FontRegistry } from './fonts/registry.js';
import type { SourceFrameService } from './source-frames/service.js';

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;
type SendJson = (res: ServerResponse, status: number, value: unknown) => void;
const binaryInput = z.object({
  expectedRevision: z.number().int().nonnegative(),
  dataBase64: z.string().max(28_000_000),
  sourceType: z.enum(['AI_GENERATED','USER_IMAGE','RECREATED_IMAGE','OFFICIAL_CLIP_FRAME']).optional(),
  sourceFrameId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/).optional(),
  format: z.enum(['png','jpeg']).optional(),
}).strict();
const sourceFrameProjectInput = z.strictObject({
  sourceFrameId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  contentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/).nullable().optional(),
  templateId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/).optional(),
  name: z.string().min(1).max(80).optional(),
  channelProfile: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/).optional(),
});
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
  path: string, method: string, body: ReadBody, json: SendJson, fonts: FontRegistry,
  sourceFrames?: Pick<SourceFrameService, 'getFrame' | 'getFrameImage'>,
  contentPlans?: { getContentPlan(contentId: string): unknown }): Promise<boolean> {
  const assertContentPlan = (contentId: string | null | undefined) => {
    if (!contentId) return;
    if (!contentPlans) throw new ThumbnailRepositoryError('CONTENT_PLAN_SERVICE_UNAVAILABLE', '콘텐츠 계획 저장소를 사용할 수 없습니다.', 503);
    contentPlans.getContentPlan(contentId);
  };
  const warningsForProject = (project: ReturnType<ThumbnailRepository['getProject']>) => {
    const frame = project.baseImage?.sourceFrame;
    return frame?.rightsReviewStatus === 'unchecked' ? [{
      code: 'SOURCE_FRAME_UNCHECKED',
      message: '소스 프레임 권리 검수가 완료되지 않았습니다. 최종 렌더는 차단됩니다.',
    }] : [];
  };
  if (fonts.serve(path, method, res)) return true;
  if (method === 'GET' && path === '/api/thumbnail-templates') { json(res,200,{data:repo.listTemplates()}); return true; }
  if (method === 'GET' && path === '/api/font-registry') { json(res,200,{data:fonts.listFonts()}); return true; }
  if (method === 'POST' && path === '/api/thumbnail-projects/from-source-frame') {
    if (!sourceFrames) throw new ThumbnailRepositoryError('SOURCE_FRAME_SERVICE_UNAVAILABLE', '소스 프레임 서비스를 사용할 수 없습니다.', 503);
    const input = sourceFrameProjectInput.parse(await body(req));
    assertContentPlan(input.contentId);
    const verified = sourceFrames.getFrameImage(input.sourceFrameId);
    const frame = verified.frame;
    if (!frame.workTitle) {
      throw new ThumbnailRepositoryError('SOURCE_FRAME_METADATA_INCOMPLETE', '작품명이 확인된 소스 프레임만 사용할 수 있습니다.', 409);
    }
    const templateId = input.templateId ?? (frame.height > frame.width ? 'shorts_discovery_v1' : 'discovery_long_v1');
    const project = repo.createProjectFromSourceFrame({
      name: input.name ?? `${frame.workTitle.slice(0, 74)} 썸네일`,
      templateId,
      channelProfile: input.channelProfile ?? 'nihon_zupzup',
      contentId: input.contentId ?? null,
      variantOfProjectId: null,
    }, {
      reference: {
        sourceFrameId: frame.id,
        sourceClipId: frame.sourceClipId,
        sourceChannelId: frame.sourceChannelId,
        youtubeVideoId: frame.youtubeVideoId,
        frameTimestampMs: frame.timestampMs,
        workTitle: frame.workTitle,
        episode: frame.episode,
        sourceUrl: frame.sourceUrl,
        rightsReviewStatus: frame.rightsReviewStatus,
      },
      bytes: verified.bytes,
      mimeType: frame.mimeType,
      width: frame.width,
      height: frame.height,
      byteLength: frame.byteLength,
      sha256: frame.sha256,
    });
    const warnings = frame.rightsReviewStatus === 'unchecked' ? [{
      code: 'SOURCE_FRAME_UNCHECKED',
      message: '소스 프레임 권리 검수가 완료되지 않았습니다. 최종 렌더는 차단됩니다.',
      sourceFrameId: frame.id,
    }] : [];
    json(res, 201, { data: project, meta: { warnings } }); return true;
  }
  if (path === '/api/thumbnail-projects') {
    if (method === 'GET') { json(res,200,{data:repo.listProjects()}); return true; }
    if (method === 'POST') {
      const input = await body(req);
      const parsed = z.object({ contentId: z.string().nullable().optional() }).passthrough().parse(input);
      assertContentPlan(parsed.contentId);
      json(res,201,{data:repo.createProject(input)}); return true;
    }
  }
  const variant = path.match(/^\/api\/thumbnail-projects\/([^/]+)\/variants$/);
  if (variant && method === 'POST') {
    json(res, 201, { data: repo.createVariant(variant[1]!, await body(req)) });
    return true;
  }
  const match = path.match(/^\/api\/thumbnail-projects\/([^/]+)(?:\/(assets|exports)(?:\/([^/]+))?)?$/);
  if (!match) return false;
  const id = match[1]!;
  if (!match[2]) {
    if (method === 'GET') {
      const project = repo.getProject(id);
      json(res,200,{data:project, meta:{warnings:warningsForProject(project)}}); return true;
    }
    if (method === 'PATCH') {
      const project = repo.updateProject(id,await body(req));
      json(res,200,{data:project, meta:{warnings:warningsForProject(project)}}); return true;
    }
    if (method === 'DELETE') { repo.deleteProject(id,await body(req)); json(res,200,{data:{deleted:true}}); return true; }
  }
  if (match[3] && method === 'GET') {
    const project = repo.getProject(id);
    const warnings = warningsForProject(project);
    const file = match[2] === 'assets' ? repo.getAsset(id,match[3]) : repo.getExport(id,match[3]);
    if (warnings.length) res.setHeader('X-Source-Frame-Warning', warnings[0]!.code);
    res.writeHead(200,{'Content-Type':file.mimeType,'Cache-Control':'no-store'}); res.end(file.bytes); return true;
  }
  if (match[2] && !match[3] && method === 'POST') {
    const input = binaryInput.parse(await body(req,28_100_000));
    const bytes = decode(input.dataBase64);
    if (match[2] === 'assets') {
      if (!input.sourceType || input.format) throw Object.assign(new Error('이미지 소스 유형을 확인하세요.'),{status:400});
      const result = repo.uploadBaseImage(id,{expectedRevision:input.expectedRevision,sourceType:input.sourceType,bytes,
        ...(input.sourceFrameId ? { sourceFrameId: input.sourceFrameId } : {})});
      json(res,201,{data:result});
    } else {
      if (!input.format || input.sourceType || input.sourceFrameId) throw Object.assign(new Error('출력 형식을 확인하세요.'),{status:400});
      const result = repo.storeExport(id,{expectedRevision:input.expectedRevision,format:input.format,bytes});
      json(res,201,{data:result});
    }
    return true;
  }
  return false;
}
