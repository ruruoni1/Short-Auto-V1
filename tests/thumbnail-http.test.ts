import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { APP_PATHS } from '../src/app/config.js';
import { SourceRepository } from '../src/app/clips/repository.js';
import { ThumbnailRepository } from '../src/app/thumbnails/repository.js';
import { FontRegistry } from '../src/app/fonts/registry.js';
import { createAppServer } from '../src/app/server.js';
import { routeThumbnails } from '../src/app/thumbnail-routes.js';

const fonts = new FontRegistry();

function png(width: number, height: number): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const tagged = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of tagged) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, tagged, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'short-auto-thumbnail-http-'));
  const repository = new SourceRepository(':memory:');
  const thumbnails = new ThumbnailRepository(root, fonts.listFonts());
  const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube: null,
    thumbnailRoute: (req, res, path, method, body, json) => routeThumbnails(thumbnails, req, res, path, method, body, json, fonts),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    repository.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = 'GET', data?: unknown) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { request, base, thumbnails };
}

test('Thumbnail HTTP persists revision-zero uploads, editable layers and exact canvas exports', async t => {
  const { request } = await setup(t);
  const templates = (await (await request('/api/thumbnail-templates')).json()).data;
  assert.equal(templates.length, 4);
  const created = await request('/api/thumbnail-projects', 'POST', { name: '한글 日本語', templateId: 'discovery_long_v1' });
  assert.equal(created.status, 201);
  let project = (await created.json()).data;
  const path = `/api/thumbnail-projects/${project.id}`;
  assert.equal(project.revision, 0);
  const image = png(1280, 720);
  const input = { expectedRevision: 0, sourceType: 'USER_IMAGE', dataBase64: image.toString('base64') };
  const upload = await request(`${path}/assets`, 'POST', input);
  assert.equal(upload.status, 201);
  const uploaded = (await upload.json()).data;
  project = uploaded.project;
  assert.equal(project.revision, 1);
  const asset = await request(`${path}/assets/${uploaded.fileName}`);
  assert.equal(asset.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), image);
  assert.equal((await request(`${path}/assets`, 'POST', input)).status, 409);
  const layers = project.layers.map((layer: Record<string, unknown>) => ({ ...layer,
    text: '한글 日本語\n줄바꿈 test', fontFamily: 'Noto Sans CJK KR', fontWeight: 700,
  }));
  const edited = await request(path, 'PATCH', { expectedRevision: 1, layers });
  assert.equal(edited.status, 200);
  project = (await edited.json()).data;
  assert.deepEqual(project.layers, layers);
  const output = await request(`${path}/exports`, 'POST', {
    expectedRevision: project.revision, format: 'png', dataBase64: image.toString('base64'),
  });
  assert.equal(output.status, 201);
  const exported = (await output.json()).data;
  assert.equal(exported.project.exports[0].productionRevision, 2);
  assert.deepEqual(Buffer.from(await (await request(`${path}/exports/${exported.fileName}`)).arrayBuffer()), image);
  const reloaded = (await (await request(path)).json()).data;
  assert.deepEqual(reloaded, exported.project);
  assert.equal((await request(path, 'DELETE', { expectedRevision: 2 })).status, 409);
  assert.equal((await request(path, 'DELETE', { expectedRevision: 3 })).status, 200);
  assert.equal((await request(path)).status, 404);
});

test('Thumbnail HTTP rejects invalid binaries, format/size mismatches and path injection without mutations', async t => {
  const { request } = await setup(t);
  const project = (await (await request('/api/thumbnail-projects', 'POST', {
    name: '검증', templateId: 'shorts_learning_v1',
  })).json()).data;
  const path = `/api/thumbnail-projects/${project.id}`;
  for (const dataBase64 of ['', '!!!!', 'YQ=', 'YR==', Buffer.from('<svg/>').toString('base64')]) {
    assert.equal((await request(`${path}/assets`, 'POST', { expectedRevision: 0, sourceType: 'USER_IMAGE', dataBase64 })).status, 400);
  }
  const dataBase64 = png(32, 32).toString('base64');
  const missingFrameId = await request(`${path}/assets`, 'POST', {
    expectedRevision: 0, sourceType: 'OFFICIAL_CLIP_FRAME', dataBase64,
  });
  assert.equal(missingFrameId.status, 400);
  assert.equal((await missingFrameId.json()).error.code, 'SOURCE_FRAME_ID_REQUIRED');
  assert.equal((await request(`${path}/assets`, 'POST', { expectedRevision: 0, sourceType: 'USER_IMAGE', dataBase64, format: 'png' })).status, 400);
  assert.equal((await request(`${path}/exports`, 'POST', { expectedRevision: 0, format: 'png', dataBase64 })).status, 400);
  assert.equal((await request(`${path}/exports`, 'POST', { expectedRevision: 0, format: 'jpeg', dataBase64 })).status, 400);
  assert.equal((await request(`${path}/assets/..%2Fproject.json`)).status, 400);
  assert.equal((await request(`${path}/assets/unknown.png`)).status, 404);
  assert.equal((await request('/api/thumbnail-projects/..%5C..%5CREADME.md')).status, 400);
  assert.equal((await (await request(path)).json()).data.revision, 0);
});

test('Thumbnail HTTP accepts a complete JPEG export at initial revision and preserves its bytes', async t => {
  const { request } = await setup(t);
  const project = (await (await request('/api/thumbnail-projects', 'POST', {
    name: 'JPEG 검증', templateId: 'training_long_v1',
  })).json()).data;
  const bytes = readFileSync(join(APP_PATHS.projectRoot, 'tests', 'fixtures', 'thumbnail-http-1280x720.jpg'));
  const response = await request(`/api/thumbnail-projects/${project.id}/exports`, 'POST', {
    expectedRevision: 0, format: 'jpeg', dataBase64: bytes.toString('base64'),
  });
  assert.equal(response.status, 201);
  const output = (await response.json()).data;
  assert.equal(output.mimeType, 'image/jpeg');
  assert.equal(output.project.revision, 1);
  const download = await request(`/api/thumbnail-projects/${project.id}/exports/${output.fileName}`);
  assert.equal(download.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('Thumbnail mutations require exact JSON media type and accept case-insensitive JSON with parameters', async t => {
  const { base, request } = await setup(t);
  const create = (contentType: string) => fetch(`${base}/api/thumbnail-projects`, {
    method: 'POST', headers: { 'Content-Type': contentType },
    body: JSON.stringify({ name: 'JSON boundary', templateId: 'discovery_long_v1' }),
  });
  for (const contentType of ['application/jsonp', 'application/json-invalid']) {
    assert.equal((await create(contentType)).status, 415);
  }
  assert.equal((await (await request('/api/thumbnail-projects')).json()).data.length, 0);
  assert.equal((await create('Application/JSON; charset=utf-8')).status, 201);
});

test('Concurrent save and export at the same revision commit only one mutation', async t => {
  const { request } = await setup(t);
  const project = (await (await request('/api/thumbnail-projects', 'POST', {
    name: 'before', templateId: 'discovery_long_v1',
  })).json()).data;
  const path = `/api/thumbnail-projects/${project.id}`;
  const [saved, exported] = await Promise.all([
    request(path, 'PATCH', { expectedRevision: 0, name: 'after' }),
    request(`${path}/exports`, 'POST', { expectedRevision: 0, format: 'png', dataBase64: png(1280, 720).toString('base64') }),
  ]);
  assert.ok((saved.status === 200 && exported.status === 409) || (saved.status === 409 && exported.status === 201));
  const rejected = saved.status === 409 ? saved : exported;
  assert.equal((await rejected.json()).error.code, 'REVISION_CONFLICT');
  const latest = (await (await request(path)).json()).data;
  assert.equal(latest.revision, 1);
  assert.equal(latest.name, saved.status === 200 ? 'after' : 'before');
  assert.equal(latest.exports.length, exported.status === 201 ? 1 : 0);
});

test('Font HTTP serves pinned verified bytes and license through same-origin allowlisted routes', async t => {
  const { request, base } = await setup(t);
  const registry = (await (await request('/api/font-registry')).json()).data;
  assert.equal(registry.length, 1);
  assert.equal(registry[0].version, '2.004');
  assert.deepEqual(registry[0].weights, [400, 700]);
  for (const file of registry[0].files) {
    const response = await request(file.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/otf');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('content-disposition'), null);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'OTTO');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    const head = await request(file.url, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(base + file.url, { headers: { Origin: 'https://foreign.example' } })).status, 403);
  }
  const license = await request(registry[0].licenseUrl);
  const bytes = Buffer.from(await license.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), registry[0].licenseSha256);
  assert.match(bytes.toString(), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.equal((await request('/fonts/noto-cjk/registry.ts')).status, 404);
  assert.equal((await request('/fonts/noto-cjk/..%2Fregistry.ts')).status, 404);
});

test('Font registry refuses altered bundle before advertising font availability', t => {
  const root = mkdtempSync(join(tmpdir(), 'short-auto-font-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'src', 'app', 'fonts', 'bundled');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'NotoSansCJKkr-Regular.otf'), 'tampered font');
  assert.throws(() => new FontRegistry(root), /integrity check failed/);
});
