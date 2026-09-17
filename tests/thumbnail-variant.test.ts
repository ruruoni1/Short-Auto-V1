import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { SourceRepository } from '../src/app/clips/repository.js';
import { FontRegistry } from '../src/app/fonts/registry.js';
import { createAppServer } from '../src/app/server.js';
import { routeThumbnails } from '../src/app/thumbnail-routes.js';
import { ThumbnailRepository, ThumbnailRepositoryError } from '../src/app/thumbnails/repository.js';

function png(width: number, height: number): Buffer {
  const crc32 = (input: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of input) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

function workspace(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'thumbnail-variant-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo: new ThumbnailRepository(root) };
}

function expectError(operation: () => unknown, code: string, status?: number): void {
  assert.throws(operation, error => {
    assert.ok(error instanceof ThumbnailRepositoryError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

test('repository creates an independent variant and leaves the source unchanged', (t) => {
  const { root, repo } = workspace(t);
  let source = repo.createProject({ name: '원본', templateId: 'discovery_long_v1', channelProfile: 'profile-a' });
  const image = png(1280, 720);
  source = repo.uploadBaseImage(source.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: image }).project;
  const layers = source.layers.map((layer, index) => ({ ...layer, text: `원본 문구 ${index}`, x: layer.x + 12 }));
  source = repo.updateProject(source.id, { expectedRevision: 1, layers, safeAreaVisible: false });
  source = repo.storeExport(source.id, { expectedRevision: 2, format: 'png', bytes: image }).project;
  const before = structuredClone(source);

  const variant = repo.createVariant(source.id, { name: 'B 문구', channelProfile: 'profile-b' });
  assert.notEqual(variant.id, source.id);
  assert.equal(variant.variantOfProjectId, source.id);
  assert.equal(variant.name, 'B 문구');
  assert.equal(variant.channelProfile, 'profile-b');
  assert.equal(variant.revision, 0);
  assert.deepEqual(variant.exports, []);
  assert.deepEqual(variant.layers, source.layers);
  assert.deepEqual(variant.canvas, source.canvas);
  assert.deepEqual(variant.safeArea, source.safeArea);
  assert.equal(variant.safeAreaVisible, false);
  assert.equal(variant.templateId, source.templateId);
  assert.notEqual(variant.baseImage!.fileName, source.baseImage!.fileName);
  assert.match(variant.baseImage!.fileName, /^base-[0-9a-f]{16}-[0-9a-f]{8}\.png$/);
  assert.deepEqual(variant.baseImage, {
    ...source.baseImage,
    fileName: variant.baseImage!.fileName,
    path: `data/thumbnail-projects/${variant.id}/assets/${variant.baseImage!.fileName}`,
  });
  assert.equal(variant.createdAt, variant.updatedAt);
  assert.ok(variant.createdAt > source.updatedAt);
  assert.deepEqual(repo.getProject(source.id), before);
  assert.equal(readdirSync(join(root, 'data', 'thumbnail-projects', variant.id, 'exports')).length, 0);
  assert.equal(readdirSync(join(root, 'data', 'thumbnail-projects', source.id, 'exports')).length, 1);

  const sourceAsset = join(root, ...source.baseImage!.path.split('/'));
  const variantAsset = join(root, ...variant.baseImage!.path.split('/'));
  assert.deepEqual(readFileSync(sourceAsset), image);
  assert.deepEqual(readFileSync(variantAsset), image);
  writeFileSync(variantAsset, 'changed variant only');
  assert.deepEqual(readFileSync(sourceAsset), image);

  const changedLayers = variant.layers.map(layer => ({ ...layer, text: 'B에서만 변경' }));
  const edited = repo.updateProject(variant.id, { expectedRevision: 0, layers: changedLayers });
  assert.deepEqual(edited.layers, changedLayers);
  assert.deepEqual(repo.getProject(source.id), before);
});

test('each request creates a separate lineage-preserving variant, including projects without a base image', (t) => {
  const { repo } = workspace(t);
  const source = repo.createProject({ name: '빈 원본', templateId: 'shorts_learning_v1' });
  const first = repo.createVariant(source.id, {});
  const second = repo.createVariant(source.id, {});
  assert.notEqual(first.id, second.id);
  assert.equal(first.variantOfProjectId, source.id);
  assert.equal(second.variantOfProjectId, source.id);
  assert.equal(first.name, source.name);
  assert.equal(first.channelProfile, source.channelProfile);
  assert.equal(first.baseImage, null);
  assert.deepEqual(first.layers, source.layers);
  const nested = repo.createVariant(first.id, { name: '두 번째 계보' });
  assert.equal(nested.variantOfProjectId, source.id);
  expectError(() => repo.createProject({
    name: '우회 변형', templateId: source.templateId, variantOfProjectId: source.id,
  }), 'VARIANT_ENDPOINT_REQUIRED');
});

test('invalid, missing and tampered source assets leave no partial variant directory', (t) => {
  const { root, repo } = workspace(t);
  for (const invalid of ['../outside', '..\\outside', 'C:\\outside', '/outside']) {
    expectError(() => repo.createVariant(invalid, {}), 'INVALID_INPUT');
  }
  const projectsRoot = join(root, 'data', 'thumbnail-projects');

  const missing = repo.createProject({ name: '누락', templateId: 'discovery_long_v1' });
  const missingUpload = repo.uploadBaseImage(missing.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: png(40, 40) });
  rmSync(join(root, ...missingUpload.project.baseImage!.path.split('/')));
  const beforeMissing = readdirSync(projectsRoot).sort();
  expectError(() => repo.createVariant(missing.id, {}), 'ASSET_NOT_FOUND', 404);
  assert.deepEqual(readdirSync(projectsRoot).sort(), beforeMissing);

  const tampered = repo.createProject({ name: '변조', templateId: 'discovery_long_v1' });
  const tamperedUpload = repo.uploadBaseImage(tampered.id, { expectedRevision: 0, sourceType: 'USER_IMAGE', bytes: png(41, 41) });
  writeFileSync(join(root, ...tamperedUpload.project.baseImage!.path.split('/')), png(42, 42));
  const beforeTamper = readdirSync(projectsRoot).sort();
  expectError(() => repo.createVariant(tampered.id, {}), 'ASSET_CORRUPT', 500);
  assert.deepEqual(readdirSync(projectsRoot).sort(), beforeTamper);

  const escaped = repo.createProject({ name: '경로 변조', templateId: 'discovery_long_v1' });
  const projectFile = join(projectsRoot, escaped.id, 'project.json');
  const raw = JSON.parse(readFileSync(projectFile, 'utf8'));
  raw.baseImage = {
    sourceType: 'USER_IMAGE', fileName: 'base.png', path: '../outside.png', mimeType: 'image/png', width: 1, height: 1,
    byteLength: 1, sha256: '0'.repeat(64), transform: { x: 0, y: 0, scale: 1, rotation: 0, blur: 0, dim: 0, brightness: 1, contrast: 1 },
    sourceFrame: null, createdAt: new Date().toISOString(),
  };
  writeFileSync(projectFile, JSON.stringify(raw));
  const beforeEscape = readdirSync(projectsRoot).sort();
  expectError(() => repo.createVariant(escaped.id, {}), 'PROJECT_CORRUPT', 500);
  assert.deepEqual(readdirSync(projectsRoot).sort(), beforeEscape);
});

test('HTTP exposes strict POST variant creation and preserves the source', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'thumbnail-variant-http-'));
  const sources = new SourceRepository(':memory:');
  const fonts = new FontRegistry();
  const repo = new ThumbnailRepository(root, fonts.listFonts());
  const server = createAppServer({ repository: sources, root, youtube: null,
    thumbnailRoute: (req, res, path, method, body, json) => routeThumbnails(repo, req, res, path, method, body, json, fonts),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    sources.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = 'GET', value?: unknown) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const source = repo.createProject({ name: 'HTTP 원본', templateId: 'training_long_v1' });
  const before = repo.getProject(source.id);
  const response = await request(`/api/thumbnail-projects/${source.id}/variants`, 'POST', { name: 'HTTP B' });
  assert.equal(response.status, 201);
  const variant = (await response.json()).data;
  assert.equal(variant.variantOfProjectId, source.id);
  assert.equal(variant.name, 'HTTP B');
  assert.equal(variant.revision, 0);
  assert.deepEqual(repo.getProject(source.id), before);
  assert.equal((await request(`/api/thumbnail-projects/${source.id}/variants`, 'POST', { unknown: true })).status, 400);
  assert.equal((await request('/api/thumbnail-projects/..%5Coutside/variants', 'POST', {})).status, 400);
  assert.equal(existsSync(join(root, 'data', 'thumbnail-projects', variant.id, 'project.json')), true);
});
