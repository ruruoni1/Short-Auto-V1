import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  ThumbnailRepository,
  ThumbnailRepositoryError,
} from '../src/app/thumbnails/repository.js';
import type { FontRegistryEntry, TextLayer } from '../src/app/thumbnails/models.js';
import type { SourceFrame } from '../src/app/source-frames/models.js';

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function jpegImage(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==',
    'base64',
  );
}

function expectError(operation: () => unknown, code: string, status?: number): ThumbnailRepositoryError {
  try { operation(); }
  catch (error) {
    assert.ok(error instanceof ThumbnailRepositoryError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return error;
  }
  assert.fail('Expected operation to throw');
}

function root(t: test.TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'thumbnail-repository-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function create(repository: ThumbnailRepository, templateId = 'discovery_long_v1') {
  return repository.createProject({ name: '저장 테스트', templateId });
}

function textLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 'text_custom', type: 'text', text: '만숀이 아파트라고?', x: 80, y: 100, width: 600, height: 220,
    rotation: 0, fontFamily: 'sans-serif', fontWeight: 800, fontSize: 88, color: '#FFFFFF', align: 'left',
    letterSpacing: 0, lineHeight: 1.05, strokeColor: '#111111', strokeWidth: 4,
    shadow: { enabled: true, x: 2, y: 3, blur: 6, opacity: 0.35 }, locked: false, visible: true,
    ...overrides,
  };
}

const bundledFont: FontRegistryEntry = {
  id: 'noto-sans-cjk-kr', family: 'Noto Sans CJK KR', version: '2.004', sourceCommit: 'a'.repeat(40), languages: ['ko', 'ja', 'latin'],
  licenseId: 'OFL-1.1', sourceUrl: 'https://example.test/pinned', licenseTextPath: 'src/app/fonts/bundled/LICENSE',
  licenseUrl: '/fonts/noto-cjk/LICENSE', licenseSourceUrl: 'https://example.test/LICENSE', licenseSha256: 'b'.repeat(64),
  bundled: true, weights: [400, 700],
  files: [
    { weight: 400, fileName: 'NotoSansCJKkr-Regular.otf', url: '/fonts/noto-cjk/NotoSansCJKkr-Regular.otf', sourceUrl: 'https://example.test/regular.otf', sha256: 'a'.repeat(64), format: 'opentype' },
    { weight: 700, fileName: 'NotoSansCJKkr-Bold.otf', url: '/fonts/noto-cjk/NotoSansCJKkr-Bold.otf', sourceUrl: 'https://example.test/bold.otf', sha256: 'c'.repeat(64), format: 'opentype' },
  ],
};

test('four immutable templates create editable projects without forced copy', (t) => {
  const repository = new ThumbnailRepository(root(t));
  const templates = repository.listTemplates();
  assert.deepEqual(templates.map(item => item.id), [
    'discovery_long_v1', 'training_long_v1', 'shorts_discovery_v1', 'shorts_learning_v1',
  ]);
  assert.deepEqual(templates.map(item => `${item.canvas.width}x${item.canvas.height}`), [
    '1280x720', '1280x720', '1080x1920', '1080x1920',
  ]);
  assert.ok(templates.every(item => item.defaultLayers.every(item => item.text === '')));
  templates[0]!.name = 'mutated outside';
  assert.equal(repository.listTemplates()[0]!.name, 'Discovery Long');

  const project = create(repository);
  assert.equal(project.revision, 0);
  assert.equal(project.baseImage, null);
  assert.equal(project.layers[0]!.fontFamily, 'sans-serif');
  assert.equal(repository.listFonts().length, 0, 'unverified fonts are not advertised');
});

test('project JSON persists across repository instances and updates use optimistic revisions', (t) => {
  const projectRoot = root(t);
  const first = new ThumbnailRepository(projectRoot);
  const created = create(first);
  const second = new ThumbnailRepository(projectRoot);
  assert.deepEqual(second.getProject(created.id), created);

  const updated = first.updateProject(created.id, {
    expectedRevision: 0,
    name: '수정된 썸네일',
    layers: [textLayer()],
    safeAreaVisible: false,
  });
  assert.equal(updated.revision, 1);
  assert.equal(updated.layers[0]!.text, '만숀이 아파트라고?');
  assert.equal(second.getProject(created.id).name, '수정된 썸네일');
  expectError(() => second.updateProject(created.id, { expectedRevision: 0, name: 'stale' }), 'REVISION_CONFLICT', 409);

  const rawPath = join(projectRoot, 'data', 'thumbnail-projects', created.id, 'project.json');
  assert.equal(JSON.parse(readFileSync(rawPath, 'utf8')).revision, 1);
});

test('layer geometry, unique IDs, strict input, and base transforms are validated', (t) => {
  const repository = new ThumbnailRepository(root(t));
  const project = create(repository);
  expectError(() => repository.updateProject(project.id, { expectedRevision: 0 }), 'INVALID_INPUT');
  expectError(() => repository.updateProject(project.id, { expectedRevision: 0, unknown: true }), 'INVALID_INPUT');
  expectError(() => repository.updateProject(project.id, {
    expectedRevision: 0, layers: [textLayer({ id: 'same' }), textLayer({ id: 'same' })],
  }), 'INVALID_INPUT');
  expectError(() => repository.updateProject(project.id, {
    expectedRevision: 0, layers: [textLayer({ x: 2_000 })],
  }), 'INVALID_INPUT');
  expectError(() => repository.updateProject(project.id, {
    expectedRevision: 0,
    baseImageTransform: { x: 640, y: 360, scale: 1, rotation: 0, blur: 0, dim: 0, brightness: 1, contrast: 1 },
  }), 'BASE_IMAGE_REQUIRED', 409);
});

test('verified font registry permits its family and rejects unknown families while CSS fallback remains available', (t) => {
  const repository = new ThumbnailRepository(root(t), [bundledFont]);
  const project = create(repository);
  assert.deepEqual(repository.listFonts(), [bundledFont]);
  assert.equal(repository.listTemplates()[0]!.defaultLayers[0]!.fontFamily, 'Noto Sans CJK KR');
  assert.equal(project.layers[0]!.fontFamily, 'Noto Sans CJK KR');
  assert.equal(project.layers[0]!.fontWeight, 700);
  const registered = repository.updateProject(project.id, {
    expectedRevision: 0, layers: [textLayer({ fontFamily: 'Noto Sans CJK KR', fontWeight: 700 })],
  });
  assert.equal(registered.layers[0]!.fontFamily, 'Noto Sans CJK KR');
  expectError(() => repository.updateProject(project.id, {
    expectedRevision: 1, layers: [textLayer({ fontFamily: 'Unlicensed Font' })],
  }), 'FONT_NOT_REGISTERED');
  expectError(() => repository.updateProject(project.id, {
    expectedRevision: 1, layers: [textLayer({ fontFamily: 'Noto Sans CJK KR', fontWeight: 800 })],
  }), 'FONT_WEIGHT_NOT_REGISTERED');
  assert.equal(repository.updateProject(project.id, {
    expectedRevision: 1, layers: [textLayer({ fontFamily: 'system-ui' })],
  }).revision, 2);
});

test('base image upload checks actual PNG structure, metadata, relative paths, and replacement cleanup', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const project = create(repository);
  const firstBytes = png(640, 360);
  const first = repository.uploadBaseImage(project.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: firstBytes });
  assert.equal(first.project.revision, 1);
  assert.equal(first.mimeType, 'image/png');
  assert.equal(first.width, 640);
  assert.equal(first.height, 360);
  assert.equal(first.sha256, createHash('sha256').update(firstBytes).digest('hex'));
  assert.match(first.project.baseImage!.path, /^data\/thumbnail-projects\/[^/]+\/assets\/base-/);
  assert.deepEqual(repository.getAsset(project.id, first.fileName).bytes, firstBytes);
  assert.equal(first.project.baseImage!.transform.scale, 2);

  const secondBytes = png(1280, 720);
  const second = repository.uploadBaseImage(project.id, { expectedRevision: 1, sourceType: 'AI_GENERATED', bytes: secondBytes });
  assert.equal(second.project.revision, 2);
  assert.equal(existsSync(join(projectRoot, 'data', 'thumbnail-projects', project.id, 'assets', first.fileName)), false);
  expectError(() => repository.getAsset(project.id, first.fileName), 'ASSET_NOT_FOUND', 404);
});

test('JPEG is detected by bytes and malformed, oversized, or mismatched data is rejected', (t) => {
  const repository = new ThumbnailRepository(root(t));
  const project = create(repository);
  const jpegBytes = jpegImage();
  const uploaded = repository.uploadBaseImage(project.id, { expectedRevision: 0, sourceType: 'RECREATED_IMAGE', bytes: jpegBytes });
  assert.equal(uploaded.mimeType, 'image/jpeg');
  assert.equal(uploaded.fileName.endsWith('.jpg'), true);
  assert.equal(uploaded.width, 1);
  assert.equal(uploaded.height, 1);
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: 1, sourceType: 'USER_IMAGE', bytes: Buffer.from('not an image'),
  }), 'INVALID_IMAGE');
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: 1, sourceType: 'USER_IMAGE', bytes: Buffer.alloc(20 * 1024 * 1024 + 1),
  }), 'INVALID_IMAGE');
  const headerOnly = png(1, 1).subarray(0, 33);
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: 1, sourceType: 'USER_IMAGE', bytes: headerOnly,
  }), 'INVALID_IMAGE');
  const badCrc = png(2, 2);
  badCrc[29] = badCrc[29]! ^ 1;
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: 1, sourceType: 'USER_IMAGE', bytes: badCrc,
  }), 'INVALID_IMAGE');
  assert.equal(repository.getProject(project.id).revision, 1, 'invalid uploads do not change revision');
});

test('official frame uploads require complete source and rights metadata', (t) => {
  const bytes = png(640, 360);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const frames = new Map<string, SourceFrame>();
  const makeFrame = (id: string, status: SourceFrame['rightsReviewStatus']): SourceFrame => ({
    id, sourceClipId: 'clip-1', youtubeVideoId: 'abcdefghijk', sourceChannelId: 'channel-1', timestampMs: 12_340,
    workTitle: '작품명', episode: '3', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    rightsReviewStatus: status, rightsReviewNotes: '검수', format: 'png', mimeType: 'image/png', width: 640, height: 360,
    byteLength: bytes.length, sha256, candidateType: 'thumbnail', localPath: `assets/frames/clip-1/${id}.png`,
    createdAt: new Date().toISOString(), revision: status === 'unchecked' ? 0 : 1,
  });
  frames.set('frame-unchecked', makeFrame('frame-unchecked', 'unchecked'));
  frames.set('frame-reviewed', makeFrame('frame-reviewed', 'reviewed'));
  frames.set('frame-rejected', makeFrame('frame-rejected', 'rejected'));
  const reader = {
    getFrame(id: string) {
      const frame = frames.get(id);
      if (!frame) throw new ThumbnailRepositoryError('SOURCE_FRAME_NOT_FOUND', '없음', 404);
      return structuredClone(frame);
    },
    getFrameImage(id: string) { return { frame: this.getFrame(id), bytes: Buffer.from(bytes) }; },
  };
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot, [], reader);
  const project = create(repository);
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes,
  }), 'SOURCE_FRAME_ID_REQUIRED');
  const result = repository.uploadBaseImage(project.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes, sourceFrameId: 'frame-unchecked',
  });
  assert.equal(result.project.baseImage!.sourceFrame!.sourceFrameId, 'frame-unchecked');
  assert.equal(result.project.baseImage!.sourceFrame!.rightsReviewStatus, 'unchecked');
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes, sourceFrameId: 'frame-unchecked',
    sourceFrame: { rightsReviewStatus: 'reviewed' },
  }), 'INVALID_INPUT');
  expectError(() => repository.storeExport(project.id, {
    expectedRevision: 1, format: 'png', bytes: png(1280, 720),
  }), 'SOURCE_FRAME_REVIEW_REQUIRED', 409);
  frames.set('frame-unchecked', { ...frames.get('frame-unchecked')!, rightsReviewStatus: 'reviewed', revision: 1 });
  assert.equal(repository.getProject(project.id).baseImage!.sourceFrame!.rightsReviewStatus, 'reviewed');
  const approvedExport = repository.storeExport(project.id, {
    expectedRevision: 1, format: 'png', bytes: png(1280, 720),
  });
  frames.set('frame-unchecked', { ...frames.get('frame-unchecked')!, rightsReviewStatus: 'rejected', revision: 2 });
  expectError(() => repository.uploadBaseImage(project.id, {
    expectedRevision: approvedExport.project.revision, sourceType: 'USER_IMAGE', bytes: png(20, 20),
  }), 'SOURCE_FRAME_REJECTED', 409);
  expectError(() => repository.updateProject(project.id, {
    expectedRevision: approvedExport.project.revision, name: '거부 뒤 편집',
  }), 'SOURCE_FRAME_REJECTED', 409);
  expectError(() => repository.createVariant(project.id, {}), 'SOURCE_FRAME_REJECTED', 409);
  expectError(() => repository.getAsset(project.id, result.fileName), 'SOURCE_FRAME_REJECTED', 409);
  expectError(() => repository.getExport(project.id, approvedExport.fileName), 'SOURCE_FRAME_REJECTED', 409);
  const second = create(repository, 'training_long_v1');
  expectError(() => repository.uploadBaseImage(second.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes: png(320, 180), sourceFrameId: 'frame-reviewed',
  }), 'SOURCE_FRAME_IMAGE_MISMATCH', 409);

  const reviewed = create(repository);
  const reviewedUpload = repository.uploadBaseImage(reviewed.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes, sourceFrameId: 'frame-reviewed',
  });
  assert.equal(repository.storeExport(reviewed.id, {
    expectedRevision: reviewedUpload.project.revision, format: 'png', bytes: png(1280, 720),
  }).project.exports.length, 1);

  const rejected = create(repository);
  expectError(() => repository.uploadBaseImage(rejected.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes, sourceFrameId: 'frame-rejected',
  }), 'SOURCE_FRAME_REJECTED', 409);

  const legacy = create(repository);
  const legacyUpload = repository.uploadBaseImage(legacy.id, {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', bytes, sourceFrameId: 'frame-reviewed',
  });
  const legacyFile = join(projectRoot, 'data', 'thumbnail-projects', legacy.id, 'project.json');
  const legacyJson = JSON.parse(readFileSync(legacyFile, 'utf8'));
  delete legacyJson.baseImage.sourceFrame.sourceFrameId;
  writeFileSync(legacyFile, JSON.stringify(legacyJson));
  assert.equal(repository.getProject(legacy.id).baseImage!.sourceFrame!.sourceFrameId, null);
  expectError(() => repository.storeExport(legacy.id, {
    expectedRevision: legacyUpload.project.revision, format: 'png', bytes: png(1280, 720),
  }), 'SOURCE_FRAME_ID_REQUIRED', 409);
});

test('exports require matching PNG/JPEG bytes and exact canvas dimensions', (t) => {
  const repository = new ThumbnailRepository(root(t));
  const project = create(repository);
  expectError(() => repository.storeExport(project.id, {
    expectedRevision: 0, format: 'jpeg', bytes: png(1280, 720),
  }), 'IMAGE_FORMAT_MISMATCH');
  expectError(() => repository.storeExport(project.id, {
    expectedRevision: 0, format: 'png', bytes: png(640, 360),
  }), 'EXPORT_SIZE_MISMATCH');
  const bytes = png(1280, 720);
  const saved = repository.storeExport(project.id, { expectedRevision: 0, format: 'png', bytes });
  assert.equal(saved.project.revision, 1);
  assert.equal(saved.project.exports[0]!.productionRevision, 0);
  assert.deepEqual(repository.getExport(project.id, saved.fileName).bytes, bytes);
  expectError(() => repository.storeExport(project.id, { expectedRevision: 0, format: 'png', bytes }), 'REVISION_CONFLICT', 409);
});

test('all identifiers and binary retrieval paths stay inside the project root', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const project = create(repository);
  const upload = repository.uploadBaseImage(project.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: png(10, 10) });
  for (const invalid of ['../outside', '..\\outside', 'C:\\outside', '/outside', '%2e%2e']) {
    expectError(() => repository.getProject(invalid), 'INVALID_INPUT');
  }
  for (const invalid of ['../project.json', '..\\project.json', 'C:\\outside.png', '/outside.png']) {
    expectError(() => repository.getAsset(project.id, invalid), 'INVALID_INPUT');
  }
  assert.ok(upload.project.baseImage!.path.startsWith('data/thumbnail-projects/'));
  assert.equal(upload.project.baseImage!.path.includes('..'), false);
});

test('delete checks revisions and removes only the selected project directory', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const first = create(repository);
  const second = create(repository, 'training_long_v1');
  const updated = repository.updateProject(first.id, { expectedRevision: 0, name: 'version one' });
  expectError(() => repository.deleteProject(first.id, { expectedRevision: 0 }), 'REVISION_CONFLICT', 409);
  repository.deleteProject(first.id, { expectedRevision: updated.revision });
  expectError(() => repository.getProject(first.id), 'PROJECT_NOT_FOUND', 404);
  assert.equal(repository.getProject(second.id).id, second.id);
  assert.equal(existsSync(join(projectRoot, 'data', 'thumbnail-projects', first.id)), false);
});

test('project lock prevents competing writers and is released after failure', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const project = create(repository);
  const lock = join(projectRoot, 'data', 'thumbnail-projects', `.${project.id}.lock`);
  writeFileSync(lock, 'other writer', { flag: 'wx' });
  expectError(() => repository.updateProject(project.id, { expectedRevision: 0, name: 'blocked' }), 'PROJECT_BUSY', 409);
  rmSync(lock);
  assert.equal(repository.updateProject(project.id, { expectedRevision: 0, name: 'saved' }).revision, 1);
});

test('corrupt or path-escaped project JSON is reported without exposing its contents', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const project = create(repository);
  const file = join(projectRoot, 'data', 'thumbnail-projects', project.id, 'project.json');
  const corrupt = JSON.parse(readFileSync(file, 'utf8'));
  corrupt.baseImage = {
    sourceType: 'USER_IMAGE', fileName: 'base.png', path: '../outside.png', mimeType: 'image/png', width: 1, height: 1,
    byteLength: 1, sha256: '0'.repeat(64), transform: { x: 0, y: 0, scale: 1, rotation: 0, blur: 0, dim: 0, brightness: 1, contrast: 1 },
    sourceFrame: null, createdAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(corrupt));
  const error = expectError(() => repository.getProject(project.id), 'PROJECT_CORRUPT', 500);
  assert.equal(error.message.includes('outside.png'), false);
});

test('stored project identity and generated paths cannot be redirected to another project', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const first = create(repository);
  const second = create(repository, 'training_long_v1');
  const uploaded = repository.uploadBaseImage(first.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: png(40, 40) });
  const file = join(projectRoot, 'data', 'thumbnail-projects', first.id, 'project.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.id = second.id;
  writeFileSync(file, JSON.stringify(raw));
  expectError(() => repository.getProject(first.id), 'PROJECT_CORRUPT', 500);

  raw.id = first.id;
  raw.baseImage.path = `data/thumbnail-projects/${second.id}/assets/${uploaded.fileName}`;
  writeFileSync(file, JSON.stringify(raw));
  expectError(() => repository.getProject(first.id), 'PROJECT_CORRUPT', 500);
});

test('missing binary files return stable not-found errors', (t) => {
  const projectRoot = root(t);
  const repository = new ThumbnailRepository(projectRoot);
  const project = create(repository);
  const upload = repository.uploadBaseImage(project.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: png(40, 40) });
  rmSync(join(projectRoot, 'data', 'thumbnail-projects', project.id, 'assets', upload.fileName));
  expectError(() => repository.getAsset(project.id, upload.fileName), 'ASSET_NOT_FOUND', 404);
});
