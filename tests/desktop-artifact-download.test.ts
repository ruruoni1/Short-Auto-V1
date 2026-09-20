import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadGitHubArtifact, type ArtifactFetchResponse } from '../src/app/desktop/artifact-download.js';

const body = Buffer.from('verified artifact');
const hash = createHash('sha256').update(body).digest('hex');
const response = (bytes: Buffer): ArtifactFetchResponse => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
const request = (root: string, overrides: Record<string, unknown> = {}) => ({ projectRoot: root, destination: 'releases/app.exe', url: 'https://github.com/ada/studio/releases/download/v1.0.0/app.exe', sha256: hash, ...overrides });

async function withRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'short-auto-download-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('downloads, verifies, and atomically replaces an artifact', async () => withRoot(async (root) => {
  await mkdirForTest(root);
  await writeFile(join(root, 'releases', 'app.exe'), 'old artifact');
  const result = await downloadGitHubArtifact(request(root), async () => response(body));
  assert.equal(result.ok, true);
  assert.equal(result.bytes, body.length);
  assert.deepEqual(await readFile(join(root, 'releases', 'app.exe')), body);
  assert.equal(await readFile(join(root, 'releases', 'app.exe.part')).catch(() => undefined), undefined);
}));

async function mkdirForTest(root: string): Promise<void> {
  await mkdir(join(root, 'releases'), { recursive: true });
}

test('rejects hash mismatch and cleans the partial file', async () => withRoot(async (root) => {
  const result = await downloadGitHubArtifact(request(root, { sha256: 'b'.repeat(64) }), async () => response(body));
  assert.deepEqual(result.diagnostics.map((item) => item.code), ['hash_mismatch']);
  assert.equal(await readFile(join(root, 'releases', 'app.exe.part')).catch(() => undefined), undefined);
  assert.equal(await readFile(join(root, 'releases', 'app.exe')).catch(() => undefined), undefined);
}));

test('rejects traversal and non-GitHub URLs before fetching', async () => withRoot(async (root) => {
  let calls = 0;
  const traversal = await downloadGitHubArtifact(request(root, { destination: '../outside.exe' }), async () => { calls += 1; return response(body); });
  const url = await downloadGitHubArtifact(request(root, { url: 'https://evil.example/app.exe' }), async () => { calls += 1; return response(body); });
  assert.deepEqual(traversal.diagnostics.map((item) => item.code), ['invalid_input']);
  assert.deepEqual(url.diagnostics.map((item) => item.code), ['invalid_input']);
  assert.equal(calls, 0);
}));

test('rejects symlink escape destinations', async (t: TestContext) => withRoot(async (root) => {
  const outside = await mkdtemp(join(tmpdir(), 'short-auto-outside-'));
  try {
    try { await symlink(outside, join(root, 'linked'), 'junction'); } catch { t.skip('symlink creation is unavailable'); return; }
    const result = await downloadGitHubArtifact(request(root, { destination: 'linked/app.exe' }), async () => response(body));
    assert.deepEqual(result.diagnostics.map((item) => item.code), ['symlink_escape']);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('rejects HTTP failure, empty response, and size limit without final files', async () => withRoot(async (root) => {
  const http = await downloadGitHubArtifact(request(root), async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }));
  const empty = await downloadGitHubArtifact(request(root), async () => response(Buffer.alloc(0)));
  const large = await downloadGitHubArtifact(request(root, { maxBytes: 3 }), async () => response(body));
  assert.deepEqual(http.diagnostics.map((item) => item.code), ['http_error']);
  assert.deepEqual(empty.diagnostics.map((item) => item.code), ['empty_response']);
  assert.deepEqual(large.diagnostics.map((item) => item.code), ['size_limit']);
  assert.equal(await readFile(join(root, 'releases', 'app.exe')).catch(() => undefined), undefined);
}));
