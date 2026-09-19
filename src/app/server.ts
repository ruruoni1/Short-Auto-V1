import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SourceRepository } from './clips/repository.js';
import { YouTubeClient } from './clips/youtube.js';
import { downloadSelectedClip } from './clips/download.js';

export type AppRoute = (req: IncomingMessage, res: ServerResponse, path: string, method: string,
  readBody: typeof body, sendJson: typeof json) => Promise<boolean>;

export interface ServerOptions {
  repository: SourceRepository;
  root: string;
  youtube: YouTubeClient | null;
  download?: typeof downloadSelectedClip;
  thumbnailRoute?: AppRoute;
  ttsRoute?: AppRoute;
  voicevoxRoute?: AppRoute;
  sourceFrameRoute?: AppRoute;
  contentPlanRoute?: AppRoute;
  autoPlannerRoute?: AppRoute;
}

const QuerySchema = z.object({
  q: z.string().max(500).optional(), channelId: z.string().optional(),
  contentType: z.enum(['anime', 'drama']).optional(), workTitle: z.string().optional(),
  clipType: z.enum(['scene','highlight','short','cutout','digest','preview','pv','other']).optional(),
  status: z.enum(['NEW','ANALYZED','REVIEWED','CANDIDATE','SELECTED','DOWNLOADED','REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

function hasJsonContentType(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

async function body(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  if (!hasJsonContentType(req)) {
    throw Object.assign(new Error('JSON 요청이 필요합니다.'), { status: 415, code: 'JSON_REQUIRED' });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 형식이 올바르지 않습니다.'), { status: 400 }); }
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createAppServer(options: ServerOptions) {
  const repo = options.repository;
  const download = options.download ?? downloadSelectedClip;
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const port = (req.socket.address() as { port?: number }).port;
      const host = `127.0.0.1:${port}`;
      if (req.headers.host !== host && req.headers.host !== `localhost:${port}`) {
        json(res, 403, { error: { code: 'HOST_REJECTED', message: '로컬 주소로 접속하세요.' } }); return;
      }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        json(res, 403, { error: { code: 'ORIGIN_REJECTED', message: '다른 사이트의 요청은 허용하지 않습니다.' } }); return;
      }
      const url = new URL(req.url ?? '/', `http://${host}`);
      const method = req.method ?? 'GET';
      const path = url.pathname;
      if (['POST','PATCH','DELETE'].includes(method) && !hasJsonContentType(req)) {
        json(res, 415, { error: { code: 'JSON_REQUIRED', message: 'JSON 요청이 필요합니다.' } }); return;
      }
      if (method === 'GET' && path === '/api/health') {
        json(res, 200, { data: { youtubeConfigured: options.youtube !== null } }); return;
      }
      if (options.thumbnailRoute && await options.thumbnailRoute(req, res, path, method, body, json)) return;
      if (options.ttsRoute && await options.ttsRoute(req, res, path, method, body, json)) return;
      if (options.voicevoxRoute && await options.voicevoxRoute(req, res, path, method, body, json)) return;
      if (options.sourceFrameRoute && await options.sourceFrameRoute(req, res, path, method, body, json)) return;
      if (options.contentPlanRoute && await options.contentPlanRoute(req, res, path, method, body, json)) return;
      if (options.autoPlannerRoute && await options.autoPlannerRoute(req, res, path, method, body, json)) return;
      if (path === '/api/channels') {
        if (method === 'GET') { json(res, 200, { data: repo.listChannels() }); return; }
        if (method === 'POST') { json(res, 201, { data: repo.createChannel(await body(req)) }); return; }
      }
      const channel = path.match(/^\/api\/channels\/([^/]+)(\/sync)?$/);
      if (channel) {
        const id = channel[1]!;
        if (!channel[2] && method === 'PATCH') { json(res, 200, { data: repo.updateChannel(id, await body(req)) }); return; }
        if (!channel[2] && method === 'DELETE') { json(res, 200, { data: repo.disableChannel(id, await body(req)) }); return; }
        if (channel[2] && method === 'POST') {
          z.object({}).strict().parse(await body(req));
          if (!options.youtube) { json(res, 409, { error: { code: 'YOUTUBE_KEY_MISSING', message: '서버의 YOUTUBE_API_KEY 설정 후 다시 실행하세요.' } }); return; }
          const source = repo.listChannels().find(item => item.id === id);
          if (!source) { json(res, 404, { error: { code: 'NOT_FOUND', message: '채널을 찾을 수 없습니다.' } }); return; }
          const job = repo.createSyncJob(id);
          const client = options.youtube;
          void (async () => {
            try {
              repo.startJob(job.id);
              const result = await client.collectChannel(source.youtubeChannelId, source.lastSyncedVideoId);
              repo.upsertRemoteClips(id, result.clips);
              repo.completeSync(job.id, { uploadsPlaylistId: result.uploadsPlaylistId, lastSyncedVideoId: result.lastSyncedVideoId });
            } catch { repo.failJob(job.id, { code: 'SYNC_FAILED', message: '동기화에 실패했습니다. API 설정·할당량·연결을 확인하고 재시도하세요.' }); }
          })();
          json(res, 202, { data: job }); return;
        }
      }
      if (method === 'GET' && path === '/api/clips') {
        const query = QuerySchema.parse(Object.fromEntries(url.searchParams));
        json(res, 200, repo.listClips(query)); return;
      }
      const clip = path.match(/^\/api\/clips\/([^/]+)(\/(review|download))?$/);
      if (clip) {
        const id = clip[1]!;
        if (!clip[2] && method === 'GET') { json(res, 200, { data: repo.getClip(id) }); return; }
        if (clip[3] === 'review' && method === 'PATCH') { json(res, 200, { data: repo.reviewClip(id, await body(req)) }); return; }
        if (clip[3] === 'download' && method === 'POST') {
          const settings = z.object({ quality: z.enum(['best','1080p','720p']), subtitles: z.boolean() }).strict().parse(await body(req));
          const job = repo.claimDownload(id, settings);
          void (async () => {
            try {
              repo.startJob(job.id);
              const files = await download(repo.getClip(id), settings, { root: options.root });
              repo.finishDownload(job.id, files);
            } catch { repo.failJob(job.id, { code: 'DOWNLOAD_FAILED', message: '다운로드 실패: yt-dlp·FFmpeg 설치와 소스 접근 상태를 확인하세요. 채택 상태는 유지됩니다.' }); }
          })();
          json(res, 202, { data: job }); return;
        }
      }
      const job = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (method === 'GET' && job) { json(res, 200, { data: repo.getJob(job[1]!) }); return; }
      const files: Record<string, [string, string]> = {
        '/studio': ['studio.html', 'text/html'], '/studio.js': ['studio.js', 'text/javascript'], '/studio.css': ['studio.css', 'text/css'],
        '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
      };
      const file = files[path];
      if (method === 'GET' && file) {
        const content = await readFile(join(options.root, 'src', 'app', 'web', file[0]));
        res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
        res.end(content); return;
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: '요청한 항목이 없습니다.' } });
    } catch (error) {
      const known = error as { status?: number; code?: string; message?: string };
      const status = error instanceof z.ZodError ? 400 : known.status ?? 500;
      json(res, status, { error: { code: known.code ?? (status === 400 ? 'INVALID_INPUT' : 'REQUEST_FAILED'),
        message: error instanceof z.ZodError ? '입력값을 확인하세요.' : status < 500 ? known.message : '요청을 처리하지 못했습니다.' } });
    }
  });
}

