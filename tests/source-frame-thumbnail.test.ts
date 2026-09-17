import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { SourceRepository } from '../src/app/clips/repository.js';
import { FontRegistry } from '../src/app/fonts/registry.js';
import { createAppServer } from '../src/app/server.js';
import { inspectFrameImage } from '../src/app/source-frames/image.js';
import { SourceFrameRepository } from '../src/app/source-frames/repository.js';
import { SourceFrameService } from '../src/app/source-frames/service.js';
import { routeThumbnails } from '../src/app/thumbnail-routes.js';
import { ThumbnailRepository } from '../src/app/thumbnails/repository.js';

const CHANNEL_ID = `UC${'f'.repeat(22)}`;
const VIDEO_ID = 'frameabc123';
const fonts = new FontRegistry();

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const tagged = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(tagged));
  return Buffer.concat([length, tagged, checksum]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'source-frame-thumbnail-'));
  mkdirSync(join(root, 'data'));
  const clips = new SourceRepository(join(root, 'data', 'sources.sqlite'));
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
  const frames = new SourceFrameRepository(join(root, 'data', 'source-frames.sqlite'), clips);
  const sourceFrames = new SourceFrameService({ projectRoot: root, clips, frames });
  const thumbnails = new ThumbnailRepository(root, fonts.listFonts());
  const server = createAppServer({ repository: clips, root, youtube: null,
    thumbnailRoute: (req, res, path, method, body, json) =>
      routeThumbnails(thumbnails, req, res, path, method, body, json, fonts, sourceFrames),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    frames.close();
    clips.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, data: unknown) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  function addFrame(id: string, timestampMs: number, bytes: Buffer, format: 'png' | 'jpeg') {
    const image = inspectFrameImage(bytes, format);
    const localPath = `assets/frames/${selected.id}/${id}.${image.extension}`;
    const absolutePath = join(root, ...localPath.split('/'));
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
    const result = frames.insertFrame({
      id, sourceClipId: selected.id, sourceChannelId: selected.channelId,
      youtubeVideoId: selected.youtubeVideoId, timestampMs, localPath, format: image.format,
      mimeType: image.mimeType, width: image.width, height: image.height,
      byteLength: image.bytes.length, sha256: image.sha256, candidateType: 'thumbnail',
      rightsReviewStatus: 'unchecked', rightsReviewNotes: '확인 필요', workTitle: selected.workTitle,
      episode: selected.episode, sourceUrl: selected.youtubeUrl,
    }).frame;
    return { frame: result, absolutePath };
  }
  return { root, request, thumbnails, addFrame };
}

test('creates independent PNG and JPEG thumbnail projects with complete source identity', async t => {
  const state = await setup(t);
  const pngBytes = png(720, 1280);
  const pngSource = state.addFrame('portrait-png', 1_250, pngBytes, 'png');
  const sourceBefore = readFileSync(pngSource.absolutePath);

  const firstResponse = await state.request('/api/thumbnail-projects/from-source-frame', {
    sourceFrameId: pngSource.frame.id,
  });
  assert.equal(firstResponse.status, 201);
  const firstPayload = await firstResponse.json();
  const first = firstPayload.data;
  assert.equal(first.revision, 0);
  assert.equal(firstPayload.meta.warnings[0].code, 'SOURCE_FRAME_UNCHECKED');
  assert.equal(first.templateId, 'shorts_discovery_v1');
  assert.equal(first.baseImage.sourceType, 'OFFICIAL_CLIP_FRAME');
  assert.equal(first.baseImage.width, 720);
  assert.equal(first.baseImage.height, 1280);
  assert.equal(first.baseImage.mimeType, 'image/png');
  assert.equal(first.baseImage.sha256, pngSource.frame.sha256);
  assert.deepEqual(first.baseImage.sourceFrame, {
    sourceClipId: pngSource.frame.sourceClipId,
    sourceChannelId: pngSource.frame.sourceChannelId,
    youtubeVideoId: pngSource.frame.youtubeVideoId,
    frameTimestampMs: pngSource.frame.timestampMs,
    workTitle: pngSource.frame.workTitle,
    episode: pngSource.frame.episode,
    sourceUrl: pngSource.frame.sourceUrl,
    rightsReviewStatus: pngSource.frame.rightsReviewStatus,
  });
  const copiedPng = readFileSync(join(state.root, ...first.baseImage.path.split('/')));
  assert.deepEqual(copiedPng, pngBytes);

  const blockedExport = await state.request(`/api/thumbnail-projects/${first.id}/exports`, {
    expectedRevision: 0, format: 'png', dataBase64: png(1080, 1920).toString('base64'),
  });
  assert.equal(blockedExport.status, 409);
  assert.equal((await blockedExport.json()).error.code, 'SOURCE_FRAME_REVIEW_REQUIRED');

  const duplicateResponse = await state.request('/api/thumbnail-projects/from-source-frame', {
    sourceFrameId: pngSource.frame.id,
  });
  assert.equal(duplicateResponse.status, 201);
  const duplicate = (await duplicateResponse.json()).data;
  assert.notEqual(duplicate.id, first.id);
  assert.deepEqual(duplicate.baseImage.sourceFrame, first.baseImage.sourceFrame);

  const jpegBytes = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'thumbnail-http-1280x720.jpg'));
  const jpegSource = state.addFrame('landscape-jpeg', 2_500, jpegBytes, 'jpeg');
  const jpegResponse = await state.request('/api/thumbnail-projects/from-source-frame', {
    sourceFrameId: jpegSource.frame.id, templateId: 'training_long_v1', name: 'JPEG 프로젝트',
    channelProfile: 'custom_profile',
  });
  assert.equal(jpegResponse.status, 201);
  const jpegProject = (await jpegResponse.json()).data;
  assert.equal(jpegProject.templateId, 'training_long_v1');
  assert.equal(jpegProject.channelProfile, 'custom_profile');
  assert.equal(jpegProject.baseImage.mimeType, 'image/jpeg');
  assert.equal(jpegProject.baseImage.width, 1280);
  assert.equal(jpegProject.baseImage.height, 720);
  assert.deepEqual(readFileSync(join(state.root, ...jpegProject.baseImage.path.split('/'))), jpegBytes);

  assert.deepEqual(readFileSync(pngSource.absolutePath), sourceBefore);
  assert.equal(state.thumbnails.listProjects().length, 3);
});

test('rejects missing, injected and tampered source frames without creating a project', async t => {
  const state = await setup(t);
  const missing = await state.request('/api/thumbnail-projects/from-source-frame', { sourceFrameId: 'missing-frame' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'SOURCE_FRAME_NOT_FOUND');

  for (const sourceFrameId of ['../frame', '..\\frame', '/absolute', 'frame.with.dot']) {
    const response = await state.request('/api/thumbnail-projects/from-source-frame', { sourceFrameId });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_INPUT');
  }

  const bytes = png(320, 180);
  const source = state.addFrame('tampered-frame', 3_000, bytes, 'png');
  const corrupted = Buffer.from(bytes);
  const lastByte = corrupted.length - 1;
  corrupted[lastByte] = corrupted[lastByte]! ^ 0xff;
  writeFileSync(source.absolutePath, corrupted);
  const beforeCount = state.thumbnails.listProjects().length;
  const tampered = await state.request('/api/thumbnail-projects/from-source-frame', { sourceFrameId: source.frame.id });
  assert.equal(tampered.status, 500);
  assert.equal((await tampered.json()).error.code, 'SOURCE_FRAME_FILE_INVALID');
  assert.equal(state.thumbnails.listProjects().length, beforeCount);
  assert.deepEqual(readFileSync(source.absolutePath), corrupted);
});
