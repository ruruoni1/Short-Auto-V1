import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { SourceRepository } from '../src/app/clips/repository.js';
import { createAppServer } from '../src/app/server.js';
import { SourceFrameError, SourceFrameRepository } from '../src/app/source-frames/repository.js';
import { createSourceFrameRoute } from '../src/app/source-frames/routes.js';
import { SourceFrameService } from '../src/app/source-frames/service.js';
import type { FrameProcessRunner, FrameRunResult } from '../src/app/source-frames/runner.js';

const CHANNEL_ID = `UC${'a'.repeat(22)}`;
const VIDEO_ID = 'abcdefghijk';

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, crc]);
}

function png(width = 320, height = 180): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function expectFrameError(operation: () => unknown, code: string, status?: number): void {
  try { operation(); }
  catch (error) {
    assert.ok(error instanceof SourceFrameError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return;
  }
  assert.fail(`Expected ${code}`);
}

async function expectFrameErrorAsync(operation: () => Promise<unknown>, code: string, status?: number): Promise<void> {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof SourceFrameError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

interface Fixture {
  root: string;
  sourceDb: string;
  frameDb: string;
  clips: SourceRepository;
  frames: SourceFrameRepository;
  clipId: string;
  videoPath: string;
}

function fixture(t: test.TestContext, downloaded = true): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'source-frame-'));
  const data = join(root, 'data');
  mkdirSync(data);
  const sourceDb = join(data, 'sources.sqlite');
  const frameDb = join(data, 'source-frames.sqlite');
  const clips = new SourceRepository(sourceDb);
  const channel = clips.createChannel({
    youtubeChannelId: CHANNEL_ID, channelName: '공식 채널', category: 'anime', sourcePriority: 'S',
    officialVerified: true, enabled: true, notes: '',
  });
  const clip = clips.upsertRemoteClips(channel.id, [{
    youtubeChannelId: CHANNEL_ID, youtubeVideoId: VIDEO_ID, title: '공식 장면', description: '',
    publishedAt: '2026-09-09T00:00:00Z', durationSeconds: 30, thumbnailUrl: null,
    viewCount: null, likeCount: null, commentCount: null,
  }])[0]!;
  const selected = clips.reviewClip(clip.id, {
    expectedRevision: clip.revision, decision: 'select', humanConfirmed: true,
    patch: { workTitle: '테스트 작품', episode: '3', reviewNotes: '사람 검수' },
  });
  const videoPath = join(root, 'assets', 'media', 'anime', VIDEO_ID, 'source.mp4');
  if (downloaded) {
    mkdirSync(dirname(videoPath), { recursive: true });
    writeFileSync(videoPath, Buffer.from('mock local video'));
    const job = clips.claimDownload(selected.id, { quality: '720p', subtitles: false });
    clips.startJob(job.id);
    clips.finishDownload(job.id, { localVideoPath: `assets/media/anime/${VIDEO_ID}/source.mp4` });
  }
  const frames = new SourceFrameRepository(frameDb, clips);
  t.after(() => {
    try { frames.close(); } catch { /* closed by test */ }
    try { clips.close(); } catch { /* closed by test */ }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, sourceDb, frameDb, clips, frames, clipId: selected.id, videoPath };
}

interface RunnerHarness {
  run: FrameProcessRunner;
  calls: { command: string; args: readonly string[]; cwd: string; shell: false }[];
}

function runner(options: {
  duration?: string;
  frameBytes?: Buffer;
  ffmpegExit?: number;
  omitOutput?: boolean;
} = {}): RunnerHarness {
  const calls: RunnerHarness['calls'] = [];
  const run: FrameProcessRunner = async (command, args, settings): Promise<FrameRunResult> => {
    calls.push({ command, args: [...args], cwd: settings.cwd, shell: settings.shell });
    if (command === 'ffprobe') return { exitCode: 0, stdout: options.duration ?? '30.000\n' };
    if (!options.omitOutput && (options.ffmpegExit ?? 0) === 0) writeFileSync(args.at(-1)!, options.frameBytes ?? png());
    return { exitCode: options.ffmpegExit ?? 0, stdout: '' };
  };
  return { run, calls };
}

test('extracts a requested frame with exact identity, timing arguments, dimensions and hash', async (t) => {
  const state = fixture(t);
  const process = runner();
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
  const result = await service.createFrame(state.clipId, {
    timestampMs: 1_234, format: 'png', candidateType: 'thumbnail', rightsReviewNotes: '검토 전 후보',
  });
  assert.equal(result.reused, false);
  assert.equal(result.frame.sourceClipId, state.clipId);
  assert.equal(result.frame.sourceChannelId, state.clips.getClip(state.clipId).channelId);
  assert.equal(result.frame.youtubeVideoId, VIDEO_ID);
  assert.equal(result.frame.timestampMs, 1_234);
  assert.equal(result.frame.width, 320);
  assert.equal(result.frame.height, 180);
  assert.equal(result.frame.rightsReviewStatus, 'unchecked');
  assert.equal(result.frame.workTitle, '테스트 작품');
  assert.equal(result.frame.episode, '3');
  assert.equal(result.frame.sourceUrl, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  assert.match(result.frame.localPath, new RegExp(`^assets/frames/${state.clipId}/[a-f0-9-]+\\.png$`));
  const bytes = readFileSync(join(state.root, ...result.frame.localPath.split('/')));
  assert.equal(result.frame.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.frame.byteLength, bytes.length);

  assert.deepEqual(process.calls.map(call => call.command), ['ffprobe', 'ffmpeg']);
  const ffmpeg = process.calls[1]!;
  assert.equal(ffmpeg.shell, false);
  assert.equal(ffmpeg.args[ffmpeg.args.indexOf('-ss') + 1], '1.234');
  assert.equal(ffmpeg.args[ffmpeg.args.indexOf('-i') + 1], state.videoPath);
  assert.equal(ffmpeg.args.includes('-frames:v'), true);
});

test('same clip and timestamp is idempotent and does not rerun FFmpeg', async (t) => {
  const state = fixture(t);
  const process = runner();
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
  const first = await service.createFrame(state.clipId, { timestampMs: 2_000, format: 'png' });
  const second = await service.createFrame(state.clipId, { timestampMs: 2_000, format: 'jpeg', candidateType: 'reference' });
  assert.equal(second.reused, true);
  assert.equal(second.frame.id, first.frame.id);
  assert.equal(second.frame.format, 'png');
  assert.equal(process.calls.length, 2);
  assert.deepEqual(service.listFrames({ clipId: state.clipId }), [first.frame]);
  assert.deepEqual(service.getFrame(first.frame.id), first.frame);
});

test('accepts a valid JPEG and verifies stored bytes when reading the image', async (t) => {
  const state = fixture(t);
  const jpeg = readFileSync(join('tests', 'fixtures', 'thumbnail-http-1280x720.jpg'));
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: runner({ frameBytes: jpeg }).run });
  const { frame } = await service.createFrame(state.clipId, { timestampMs: 2_001, format: 'jpeg' });
  assert.equal(frame.mimeType, 'image/jpeg');
  assert.equal(frame.width, 1280);
  assert.equal(frame.height, 720);
  assert.deepEqual(service.getFrameImage(frame.id).bytes, jpeg);

  writeFileSync(join(state.root, ...frame.localPath.split('/')), Buffer.from('tampered'));
  expectFrameError(() => service.getFrameImage(frame.id), 'SOURCE_FRAME_FILE_INVALID', 500);
});

test('requires selected local media and rejects invalid timestamps before process execution', async (t) => {
  const state = fixture(t, false);
  const process = runner();
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
  await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs: 0 }), 'CLIP_MEDIA_REQUIRED', 409);
  for (const timestampMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs }), 'INVALID_INPUT');
  }
  assert.equal(process.calls.length, 0);
});

test('enforces clip state and accepts selected clips whose downloaded file is retained', async (t) => {
  const rejected = fixture(t);
  const rejectedDb = new DatabaseSync(rejected.sourceDb);
  rejectedDb.prepare("UPDATE source_clips SET status = 'REJECTED' WHERE id = ?").run(rejected.clipId);
  rejectedDb.close();
  const rejectedRunner = runner();
  const rejectedService = new SourceFrameService({ projectRoot: rejected.root, clips: rejected.clips, frames: rejected.frames, run: rejectedRunner.run });
  await expectFrameErrorAsync(() => rejectedService.createFrame(rejected.clipId, { timestampMs: 1 }), 'CLIP_NOT_SELECTED', 409);
  assert.equal(rejectedRunner.calls.length, 0);

  const selected = fixture(t);
  const selectedDb = new DatabaseSync(selected.sourceDb);
  selectedDb.prepare("UPDATE source_clips SET status = 'SELECTED' WHERE id = ?").run(selected.clipId);
  selectedDb.close();
  const selectedService = new SourceFrameService({
    projectRoot: selected.root,
    clips: selected.clips,
    frames: selected.frames,
    run: runner({ frameBytes: png() }).run,
  });
  assert.equal((await selectedService.createFrame(selected.clipId, { timestampMs: 1, format: 'png' })).frame.sourceClipId, selected.clipId);
});

test('rejects a missing local source file before probing', async (t) => {
  const state = fixture(t);
  rmSync(state.videoPath, { force: true });
  const process = runner();
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
  await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs: 1 }), 'SOURCE_MEDIA_NOT_FOUND', 409);
  assert.equal(process.calls.length, 0);
});

test('rejects metadata and probed duration boundaries without creating a row', async (t) => {
  const state = fixture(t);
  const process = runner({ duration: '2.500' });
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
  await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs: 30_000 }), 'FRAME_TIMESTAMP_OUT_OF_RANGE');
  assert.equal(process.calls.length, 0);
  await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs: 2_500 }), 'FRAME_TIMESTAMP_OUT_OF_RANGE');
  assert.deepEqual(process.calls.map(call => call.command), ['ffprobe']);
  assert.deepEqual(state.frames.listFrames(), []);
});

test('rejects traversal, absolute and symlink media paths', async (t) => {
  for (const localPath of ['../outside.mp4', String.raw`C:\outside.mp4`, '/outside.mp4']) {
    const state = fixture(t);
    const raw = new DatabaseSync(state.sourceDb);
    raw.prepare("UPDATE source_clips SET local_video_path = ?, status = 'DOWNLOADED' WHERE id = ?").run(localPath, state.clipId);
    raw.close();
    const process = runner();
    const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
    await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs: 1 }), 'SOURCE_PATH_INVALID');
    assert.equal(process.calls.length, 0);
  }

  const state = fixture(t);
  const outside = join(dirname(state.root), `${state.clipId}-outside.mp4`);
  writeFileSync(outside, 'outside');
  t.after(() => rmSync(outside, { force: true }));
  const link = join(dirname(state.videoPath), 'linked.mp4');
  try { symlinkSync(outside, link, 'file'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('File symlinks are unavailable in this Windows environment'); return; }
    throw error;
  }
  const raw = new DatabaseSync(state.sourceDb);
  raw.prepare('UPDATE source_clips SET local_video_path = ? WHERE id = ?').run(`assets/media/anime/${VIDEO_ID}/linked.mp4`, state.clipId);
  raw.close();
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: runner().run });
  await expectFrameErrorAsync(() => service.createFrame(state.clipId, { timestampMs: 1 }), 'SOURCE_PATH_INVALID');
});

test('probe, extraction, missing output, invalid bytes and format mismatch leave no row or final frame', async (t) => {
  const scenarios = [
    { harness: runner({ duration: 'not-a-duration' }), code: 'FRAME_PROBE_FAILED' },
    { harness: runner({ ffmpegExit: 1 }), code: 'FRAME_EXTRACTION_FAILED' },
    { harness: runner({ omitOutput: true }), code: 'FRAME_OUTPUT_MISSING' },
    { harness: runner({ frameBytes: Buffer.from('truncated') }), code: 'FRAME_IMAGE_INVALID' },
    { harness: runner({ frameBytes: readFileSync(join('tests', 'fixtures', 'thumbnail-http-1280x720.jpg')) }), code: 'FRAME_IMAGE_INVALID', format: 'png' },
  ] as const;
  for (const [index, scenario] of scenarios.entries()) {
    const state = fixture(t);
    const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: scenario.harness.run });
    await expectFrameErrorAsync(
      () => service.createFrame(state.clipId, {
        timestampMs: 1_000 + index,
        format: 'format' in scenario ? scenario.format : 'jpeg',
      }),
      scenario.code,
    );
    assert.deepEqual(state.frames.listFrames(), []);
    const frameRoot = join(state.root, 'assets', 'frames');
    const files = existsSync(frameRoot) ? readdirSync(frameRoot, { recursive: true }).filter(item => String(item).endsWith('.jpg') || String(item).endsWith('.png')) : [];
    assert.deepEqual(files, []);
    const temp = join(state.root, 'temp', 'source-frames');
    if (existsSync(temp)) assert.deepEqual(readdirSync(temp), []);
  }
});

test('repository detects tampered clip identity and generated path', async (t) => {
  const state = fixture(t);
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: runner({ frameBytes: png() }).run });
  const { frame } = await service.createFrame(state.clipId, { timestampMs: 4_000, format: 'png' });
  const raw = new DatabaseSync(state.frameDb);
  raw.prepare('UPDATE source_frames SET source_channel_id = ? WHERE id = ?').run('wrong-channel', frame.id);
  raw.close();
  expectFrameError(() => state.frames.getFrame(frame.id), 'SOURCE_FRAME_CORRUPT', 500);

  const raw2 = new DatabaseSync(state.frameDb);
  raw2.prepare('UPDATE source_frames SET source_channel_id = ?, local_path = ? WHERE id = ?').run(
    state.clips.getClip(state.clipId).channelId, `assets/frames/${state.clipId}/other.png`, frame.id,
  );
  raw2.close();
  expectFrameError(() => state.frames.getFrame(frame.id), 'SOURCE_FRAME_CORRUPT', 500);

  const raw3 = new DatabaseSync(state.frameDb);
  raw3.prepare('UPDATE source_frames SET local_path = ?, mime_type = ? WHERE id = ?').run(
    frame.localPath, 'image/jpeg', frame.id,
  );
  raw3.close();
  expectFrameError(() => state.frames.getFrame(frame.id), 'SOURCE_FRAME_CORRUPT', 500);
});

test('HTTP creates, reuses, lists and gets frames with the existing JSON error envelope', async (t) => {
  const state = fixture(t);
  const process = runner({ frameBytes: png(640, 360) });
  const service = new SourceFrameService({ projectRoot: state.root, clips: state.clips, frames: state.frames, run: process.run });
  const server = createAppServer({
    repository: state.clips,
    root: state.root,
    youtube: null,
    sourceFrameRoute: createSourceFrameRoute(service),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => new Promise<void>(resolve => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, method = 'GET', value?: unknown) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });

  const created = await request(`/api/source-clips/${state.clipId}/frames`, 'POST', { timestampMs: 5_000, format: 'png' });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.meta.reused, false);
  const id = createdBody.data.id;
  const reused = await request(`/api/source-clips/${state.clipId}/frames`, 'POST', { timestampMs: 5_000 });
  assert.equal(reused.status, 200);
  assert.equal((await reused.json()).meta.reused, true);
  const list = await request(`/api/source-frames?clipId=${state.clipId}`);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data.length, 1);
  assert.equal((await (await request(`/api/source-frames/${id}`)).json()).data.id, id);
  const image = await request(`/api/source-frames/${id}/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png(640, 360));
  const unknown = await request('/api/source-frames/not-found');
  assert.equal(unknown.status, 404);
  const error = (await unknown.json()).error;
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message']);
  assert.equal(error.code, 'SOURCE_FRAME_NOT_FOUND');
  assert.equal(error.message.includes(state.root), false);
  assert.equal((await request('/api/source-frames?unexpected=1')).status, 400);
});
