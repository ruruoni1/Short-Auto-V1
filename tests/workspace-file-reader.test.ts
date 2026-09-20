import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { FileWorkspaceReader, readWorkspaceSnapshotFile } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'workspace-reader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = { schemaVersion: 1 as const, revision: 4, workspace: exampleWorkspace() };
  await mkdir(join(root, 'snapshots'));
  await writeFile(join(root, 'snapshots', 'workspace.json'), JSON.stringify(snapshot), 'utf8');
  return { root, snapshot };
}

test('reads the latest snapshot and isolates the parsed result', async (t) => {
  const { root, snapshot } = await fixture(t);
  const reader = new FileWorkspaceReader(root, 'snapshots/workspace.json');
  const first = await reader.read();
  assert.equal(first.valid, true);
  if (!first.valid) return;
  assert.deepEqual(first.snapshot, snapshot);
  first.snapshot.workspace.projects[0]!.production.project.title = 'mutated';
  await writeFile(join(root, 'snapshots', 'workspace.json'), JSON.stringify({ ...snapshot, revision: 5 }), 'utf8');
  const second = await reader.read();
  assert.equal(second.valid, true);
  if (second.valid) assert.equal(second.snapshot.revision, 5);
});

test('rejects absolute, traversal, null and Windows ADS paths', async (t) => {
  const { root } = await fixture(t);
  for (const snapshotPath of ['C:\\outside.json', '/outside.json', '../outside.json', 'nested/../../x.json', 'workspace.json\0x', 'workspace.json:secret']) {
    const result = await readWorkspaceSnapshotFile(root, snapshotPath);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.diagnostics[0]!.code, 'INVALID_SNAPSHOT_PATH');
  }
});

test('rejects a symlink that escapes the workspace root', async (t) => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'workspace-reader-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'workspace.json'), '{}', 'utf8');
  await symlink(join(outside, 'workspace.json'), join(root, 'snapshots', 'escape.json'));
  const result = await readWorkspaceSnapshotFile(root, 'snapshots/escape.json');
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.diagnostics[0]!.code, 'SYMLINK_ESCAPE');
});

test('returns stable diagnostics for missing, nonregular, size, encoding and JSON failures', async (t) => {
  const { root } = await fixture(t);
  for (const [path, expected] of [['missing.json', 'SNAPSHOT_NOT_FOUND'], ['snapshots', 'SNAPSHOT_NOT_REGULAR']] as const) {
    const result = await readWorkspaceSnapshotFile(root, path);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.diagnostics[0]!.code, expected);
  }
  await writeFile(join(root, 'large.json'), '{}', 'utf8');
  const large = await readWorkspaceSnapshotFile(root, 'large.json', { maxBytes: 1 });
  assert.equal(large.valid, false);
  if (!large.valid) assert.equal(large.diagnostics[0]!.code, 'SNAPSHOT_TOO_LARGE');
  await writeFile(join(root, 'bad-utf8.json'), Buffer.from([0xc3, 0x28]));
  const utf8 = await readWorkspaceSnapshotFile(root, 'bad-utf8.json');
  assert.equal(utf8.valid, false);
  if (!utf8.valid) assert.equal(utf8.diagnostics[0]!.code, 'INVALID_UTF8');
  await writeFile(join(root, 'bad-json.json'), '{', 'utf8');
  const json = await readWorkspaceSnapshotFile(root, 'bad-json.json');
  assert.equal(json.valid, false);
  if (!json.valid) assert.equal(json.diagnostics[0]!.code, 'INVALID_JSON');
});

test('reuses snapshot validation diagnostics for invalid snapshots', async (t) => {
  const { root, snapshot } = await fixture(t);
  await writeFile(join(root, 'invalid.json'), JSON.stringify({ ...snapshot, schemaVersion: 2 }), 'utf8');
  const result = await readWorkspaceSnapshotFile(root, 'invalid.json');
  assert.equal(result.valid, false);
  if (!result.valid) assert.deepEqual(result.diagnostics, [{ severity: 'error', code: 'UNSUPPORTED_SCHEMA_VERSION', path: 'schemaVersion', message: 'schemaVersion must be 1' }]);
});
