import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_PATHS } from './config.js';
import { loadActiveDocuments } from './documents.js';
import { SourceRepository } from './clips/repository.js';
import { YouTubeClient } from './clips/youtube.js';
import { createAppServer } from './server.js';

loadActiveDocuments();
mkdirSync(APP_PATHS.data, { recursive: true });
const repository = new SourceRepository(join(APP_PATHS.data, 'sources.sqlite'));
const youtube = process.env.YOUTUBE_API_KEY ? new YouTubeClient(process.env.YOUTUBE_API_KEY) : null;
const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube });
const port = Number(process.env.SHORT_AUTO_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid SHORT_AUTO_PORT');
server.once('error', () => { repository.close(); console.error('로컬 서버를 시작할 수 없습니다. 포트가 사용 중인지 확인하세요.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  repository.recoverInterruptedJobs();
  console.log(`Short-auto: http://127.0.0.1:${port}`);
});
function stop() { server.close(() => { repository.close(); process.exit(0); }); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
