import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stageDesktopUpdate } from '../src/app/desktop/update-transaction.js';
import type { ArtifactFetchResponse } from '../src/app/desktop/artifact-download.js';

const body = Buffer.from('staged update');
const hash = createHash('sha256').update(body).digest('hex');
const response = (): ArtifactFetchResponse => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(body).buffer });
const makeManifest = (version = '1.1.0', channel: 'stable' | 'beta' = 'stable') => ({ version, tag: `v${version}`, channel, artifacts: [{ path: 'app.exe', sha256: hash }] });

async function roots(): Promise<{ base: string; installRoot: string; workspaceRoot: string }> {
  const base = await mkdtemp(join(tmpdir(), 'short-auto-transaction-'));
  const installRoot = join(base, 'install');
  const workspaceRoot = join(base, 'workspace');
  await (await import('node:fs/promises')).mkdir(installRoot, { recursive: true });
  await (await import('node:fs/promises')).mkdir(workspaceRoot, { recursive: true });
  return { base, installRoot, workspaceRoot };
}

test('does not stage when update policy says unavailable', async () => {
  const { base, installRoot, workspaceRoot } = await roots();
  try {
    const result = await stageDesktopUpdate({ installRoot, workspaceRoot, currentVersion: '1.1.0', currentChannel: 'stable', manifest: makeManifest(), artifactPath: 'app.exe', artifactUrl: 'https://github.com/ada/studio/releases/download/v1.1.0/app.exe', fetcher: async () => response() });
    assert.deepEqual(result.diagnostics.map((item) => item.code), ['update_unavailable']);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects workspace/install overlap and never downloads', async () => {
  const { base, installRoot, workspaceRoot } = await roots();
  try {
    let calls = 0;
    const result = await stageDesktopUpdate({ installRoot, workspaceRoot: installRoot, currentVersion: '1.0.0', currentChannel: 'stable', manifest: makeManifest(), artifactPath: 'app.exe', artifactUrl: 'https://github.com/ada/studio/releases/download/v1.1.0/app.exe', fetcher: async () => { calls += 1; return response(); } });
    assert.deepEqual(result.diagnostics.map((item) => item.code), ['root_overlap']);
    assert.equal(calls, 0);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('stages verified artifact under installRoot updates and returns manifest', async () => {
  const { base, installRoot, workspaceRoot } = await roots();
  try {
    const result = await stageDesktopUpdate({ installRoot, workspaceRoot, currentVersion: '1.0.0', currentChannel: 'stable', manifest: makeManifest(), artifactPath: 'app.exe', artifactUrl: 'https://github.com/ada/studio/releases/download/v1.1.0/app.exe', fetcher: async () => response() });
    assert.equal(result.ok, true);
    assert.equal(result.stagedPath?.endsWith(join('.updates', '1.1.0', 'app.exe')), true);
    assert.deepEqual(await readFile(result.stagedPath!), body);
    assert.equal(result.manifest?.tag, 'v1.1.0');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('cleans failed staging and reports artifact hash failure', async () => {
  const { base, installRoot, workspaceRoot } = await roots();
  try {
    const result = await stageDesktopUpdate({ installRoot, workspaceRoot, currentVersion: '1.0.0', currentChannel: 'stable', manifest: makeManifest(), artifactPath: 'app.exe', artifactUrl: 'https://github.com/ada/studio/releases/download/v1.1.0/app.exe', fetcher: async () => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(Buffer.from('wrong')).buffer }) });
    assert.deepEqual(result.diagnostics.map((item) => item.code), ['download_failed']);
    assert.equal(await readFile(join(installRoot, '.updates', '1.1.0', 'app.exe')).catch(() => undefined), undefined);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects channel/version and selected artifact mismatches', async () => {
  const { base, installRoot, workspaceRoot } = await roots();
  try {
    const channel = await stageDesktopUpdate({ installRoot, workspaceRoot, currentVersion: '1.0.0', currentChannel: 'stable', manifest: makeManifest('1.1.0', 'beta'), artifactPath: 'app.exe', artifactUrl: 'https://github.com/ada/studio/releases/download/v1.1.0-beta/app.exe', fetcher: async () => response() });
    const artifact = await stageDesktopUpdate({ installRoot, workspaceRoot, currentVersion: '1.0.0', currentChannel: 'stable', manifest: makeManifest(), artifactPath: 'other.exe', artifactUrl: 'https://github.com/ada/studio/releases/download/v1.1.0/app.exe', fetcher: async () => response() });
    assert.deepEqual(channel.diagnostics.map((item) => item.code), ['update_unavailable']);
    assert.deepEqual(artifact.diagnostics.map((item) => item.code), ['artifact_mismatch']);
  } finally { await rm(base, { recursive: true, force: true }); }
});
