import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStudioInstallManager, defaultVoiceStudioInstallCandidates } from '../src/app/voicestudio/install-manager.js';
import { VoiceStudioError } from '../src/app/voicestudio/models.js';

const release = {
  version: 'v0.5.3',
  installer: { name: 'VoiceStudio-Electron-0.5.3-win-x64.exe', url: 'https://github.com/example/installer.exe', sha256: 'a'.repeat(64) },
  checksumManifest: { name: 'SHA256SUMS-Windows.x64.txt', url: 'https://github.com/example/checksums.txt' },
};
const downloaded = { path: 'C:\\temp\\VoiceStudio.exe', bytes: 10, sha256: 'a'.repeat(64), downloaded: true };

test('default install candidates include the current-user product executable name', () => {
  const candidates = defaultVoiceStudioInstallCandidates({
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
  });
  assert.ok(candidates.includes('C:\\Users\\test\\AppData\\Local\\VoiceStudio (Current User)\\omnivoice-studio.exe'));
});

test('install manager runs a consented installer and waits for installed executable', async () => {
  let runs = 0;
  let probes = 0;
  const manager = new VoiceStudioInstallManager({} as never, {
    download: async () => downloaded,
    runInstaller: async path => { assert.equal(path, downloaded.path); runs += 1; return { exitCode: 0 }; },
    locator: { find: async () => { probes += 1; return probes < 2 ? undefined : { executablePath: 'C:\\Users\\test\\VoiceStudio.exe' }; } },
    sleep: async () => {},
  });
  const result = await manager.install(release, { targetDirectory: 'C:\\temp', pollIntervalMs: 1, installTimeoutMs: 100 });
  assert.equal(runs, 1);
  assert.equal(result.installation.executablePath, 'C:\\Users\\test\\VoiceStudio.exe');
});

test('install manager does not accept a failed installer process', async () => {
  const manager = new VoiceStudioInstallManager({} as never, {
    download: async () => downloaded,
    runInstaller: async () => ({ exitCode: 1 }),
  });
  await assert.rejects(() => manager.install(release, { targetDirectory: 'C:\\temp' }), (error: unknown) => error instanceof VoiceStudioError && error.code === 'INSTALLER_EXITED');
});

test('install manager reports when install completion is not detected', async () => {
  const manager = new VoiceStudioInstallManager({} as never, {
    download: async () => downloaded,
    runInstaller: async () => ({ exitCode: 0 }),
    locator: { find: async () => undefined },
    sleep: async () => {},
  });
  await assert.rejects(() => manager.install(release, { targetDirectory: 'C:\\temp', pollIntervalMs: 1, installTimeoutMs: 2 }), (error: unknown) => error instanceof VoiceStudioError && error.code === 'INSTALL_NOT_DETECTED');
});
