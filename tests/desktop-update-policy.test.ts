import test from 'node:test';
import assert from 'node:assert/strict';
import { decideDesktopUpdate } from '../src/app/desktop/update-policy.js';

const manifest = (version: string, channel: 'stable' | 'beta') => ({ version, tag: `v${version}`, channel, artifacts: [{ path: 'Short-auto.exe' }] });

test('stable channel considers stable releases only', () => {
  const stable = decideDesktopUpdate({ currentVersion: '1.0.0', currentChannel: 'stable', manifest: manifest('1.1.0', 'stable') });
  const beta = decideDesktopUpdate({ currentVersion: '1.0.0', currentChannel: 'stable', manifest: manifest('1.2.0-beta.1', 'beta') });
  assert.deepEqual([stable.shouldUpdate, stable.reason], [true, 'update_available']);
  assert.deepEqual([beta.shouldUpdate, beta.reason], [false, 'channel_not_allowed']);
});

test('beta channel considers both stable and beta releases', () => {
  const stable = decideDesktopUpdate({ currentVersion: '1.0.0-beta.1', currentChannel: 'beta', manifest: manifest('1.0.0', 'stable') });
  const beta = decideDesktopUpdate({ currentVersion: '1.0.0', currentChannel: 'beta', manifest: manifest('1.1.0-beta.1', 'beta') });
  assert.equal(stable.shouldUpdate, true);
  assert.equal(beta.shouldUpdate, true);
});

test('same and lower versions do not update, including prerelease precedence', () => {
  assert.equal(decideDesktopUpdate({ currentVersion: '1.2.3', currentChannel: 'stable', manifest: manifest('1.2.3', 'stable') }).reason, 'up_to_date');
  assert.equal(decideDesktopUpdate({ currentVersion: '1.2.3', currentChannel: 'stable', manifest: manifest('1.2.2', 'stable') }).reason, 'up_to_date');
  assert.equal(decideDesktopUpdate({ currentVersion: '1.2.3-beta.2', currentChannel: 'beta', manifest: manifest('1.2.3-beta.1', 'beta') }).reason, 'up_to_date');
  assert.equal(decideDesktopUpdate({ currentVersion: '1.2.3-beta.2', currentChannel: 'beta', manifest: manifest('1.2.3', 'stable') }).shouldUpdate, true);
});

test('invalid current input and manifest return stable structured diagnostics', () => {
  const result = decideDesktopUpdate({ currentVersion: '1.0', currentChannel: 'stable', manifest: { version: 'bad', tag: 'wrong', channel: 'stable', artifacts: [{ path: '../escape.exe' }] } });
  assert.equal(result.ok, false);
  assert.equal(result.shouldUpdate, false);
  assert.equal(result.reason, 'invalid_input');
  assert.deepEqual(result.diagnostics.map((item) => [item.code, item.path]), [
    ['invalid_current_version', 'currentVersion'],
    ['invalid_manifest', 'manifest'],
  ]);
  assert.equal(result.diagnostics[1]?.details?.map((item) => item.code).join(','), 'invalid_version,invalid_tag,invalid_artifact_path');
});

test('rejects invalid current channel without side effects', () => {
  const result = decideDesktopUpdate({ currentVersion: '1.0.0', currentChannel: 'preview' as 'stable', manifest: manifest('1.1.0', 'stable') });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ['invalid_current_channel']);
});
