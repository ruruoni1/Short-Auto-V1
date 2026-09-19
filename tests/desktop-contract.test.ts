import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDesktopWorkspaceLayout, validateReleaseManifest } from '../src/app/desktop/contract.js';

test('derives isolated Windows workspace layout without filesystem effects', () => {
  const layout = deriveDesktopWorkspaceLayout({ documentsRoot: 'C:\\Users\\Ada\\Documents', installRoot: 'C:\\Program Files\\Nihon Studio' });
  assert.equal(layout.workspaceRoot, 'C:\\Users\\Ada\\Documents\\NihonZupZupStudio');
  assert.equal(layout.projects, 'C:\\Users\\Ada\\Documents\\NihonZupZupStudio\\projects');
  assert.notEqual(layout.installRoot, layout.workspaceRoot);
});

test('derives POSIX workspace layout and rejects overlap', () => {
  const layout = deriveDesktopWorkspaceLayout({ documentsRoot: '/home/ada/Documents', installRoot: '/opt/nihon-studio' });
  assert.equal(layout.exports, '/home/ada/Documents/NihonZupZupStudio/exports');
  assert.throws(() => deriveDesktopWorkspaceLayout({ documentsRoot: '/home/ada', installRoot: '/home/ada/NihonZupZupStudio/app' }), /separate/);
});

test('rejects traversal and absolute release artifact paths with stable diagnostics', () => {
  const result = validateReleaseManifest({ version: '1.2.3', tag: 'v1.2.3', channel: 'stable', artifacts: [{ path: '../app.exe' }, { path: 'C:\\app.exe' }, { path: '/tmp/app.exe' }] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]), [
    ['invalid_artifact_path', 'artifacts[0].path'],
    ['invalid_artifact_path', 'artifacts[1].path'],
    ['invalid_artifact_path', 'artifacts[2].path'],
  ]);
});

test('accepts stable and beta semantic versions only when tags match', () => {
  assert.equal(validateReleaseManifest({ version: '1.2.3', tag: 'v1.2.3', channel: 'stable', artifacts: [{ path: 'Short-auto-1.2.3.exe' }] }).ok, true);
  assert.equal(validateReleaseManifest({ version: '1.2.3-beta.1', tag: 'v1.2.3-beta.1', channel: 'beta', artifacts: [{ path: 'Short-auto-1.2.3-beta.1.exe' }] }).ok, true);
  const invalid = validateReleaseManifest({ version: '01.2.3', tag: 'v01.2.3', channel: 'stable', artifacts: [{ path: 'app.exe' }] });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0]?.code, 'invalid_version');
});

test('rejects secret-like metadata fields', () => {
  const result = validateReleaseManifest({ version: '1.2.3', tag: 'v1.2.3', channel: 'stable', apiKey: 'do-not-ship', artifacts: [{ path: 'app.exe' }] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]), [['secret_like_field', 'apiKey']]);
});
