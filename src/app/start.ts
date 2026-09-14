import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_PATHS } from './config.js';
import { loadActiveDocuments } from './documents.js';
import { SourceRepository } from './clips/repository.js';
import { YouTubeClient } from './clips/youtube.js';
import { createAppServer } from './server.js';
import { ThumbnailRepository } from './thumbnails/repository.js';
import { routeThumbnails } from './thumbnail-routes.js';
import { FontRegistry } from './fonts/registry.js';
import { VoicevoxClient } from './voicevox/client.js';
import { VoicevoxRepository } from './voicevox/repository.js';
import { VoicevoxService } from './voicevox/service.js';
import { createVoicevoxRoute } from './voicevox/routes.js';
import { SourceFrameRepository } from './source-frames/repository.js';
import { SourceFrameService } from './source-frames/service.js';
import { createSourceFrameRoute } from './source-frames/routes.js';

loadActiveDocuments();
mkdirSync(APP_PATHS.data, { recursive: true });
const repository = new SourceRepository(join(APP_PATHS.data, 'sources.sqlite'));
const youtube = process.env.YOUTUBE_API_KEY ? new YouTubeClient(process.env.YOUTUBE_API_KEY) : null;
const fonts = new FontRegistry(APP_PATHS.projectRoot);
const thumbnails = new ThumbnailRepository(APP_PATHS.projectRoot, fonts.listFonts());
const sourceFrames = new SourceFrameRepository(join(APP_PATHS.data, 'source-frames.sqlite'), repository);
const sourceFrameService = new SourceFrameService({ projectRoot: APP_PATHS.projectRoot, clips: repository, frames: sourceFrames });
const voicevox = new VoicevoxService(
  new VoicevoxClient(process.env.VOICEVOX_ENDPOINT ? { endpoint: process.env.VOICEVOX_ENDPOINT } : {}),
  new VoicevoxRepository(APP_PATHS.projectRoot),
);
const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube,
  thumbnailRoute: (req, res, path, method, body, json) =>
    routeThumbnails(thumbnails, req, res, path, method, body, json, fonts),
  voicevoxRoute: createVoicevoxRoute(voicevox),
  sourceFrameRoute: createSourceFrameRoute(sourceFrameService),
});
const port = Number(process.env.SHORT_AUTO_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid SHORT_AUTO_PORT');
server.once('error', () => { sourceFrames.close(); repository.close(); console.error('로컬 서버를 시작할 수 없습니다. 포트가 사용 중인지 확인하세요.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  repository.recoverInterruptedJobs();
  console.log(`Short-auto: http://127.0.0.1:${port}`);
});
function stop() { server.close(() => { sourceFrames.close(); repository.close(); process.exit(0); }); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
