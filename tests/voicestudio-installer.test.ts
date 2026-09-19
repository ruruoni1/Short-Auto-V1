import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStudioInstaller } from '../src/app/voicestudio/installer.js';
import { VoiceStudioError } from '../src/app/voicestudio/models.js';

const installerName = 'VoiceStudio-Electron-0.5.3-win-x64.exe';
const checksumName = 'SHA256SUMS-Windows.x64.txt';
const sha256 = 'a'.repeat(64);

test('installer resolves the stable Electron Windows asset and checksum', async () => {
  const calls: string[] = [];
  const installer = new VoiceStudioInstaller({ fetch: async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/releases/latest')) return Response.json({
      tag_name: 'v0.5.3', draft: false, prerelease: false,
      assets: [
        { name: installerName, browser_download_url: `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${installerName}` },
        { name: checksumName, browser_download_url: `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${checksumName}` },
      ],
    });
    return new Response(`${sha256}  ${installerName}\n`, { headers: { 'content-type': 'text/plain' } });
  }});
  assert.deepEqual(await installer.resolveLatestStable(), {
    version: 'v0.5.3',
    installer: { name: installerName, url: `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${installerName}`, sha256 },
    checksumManifest: { name: checksumName, url: `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${checksumName}` },
  });
  assert.equal(calls.length, 2);
});

test('installer rejects a release without an unambiguous checksum', async () => {
  const installer = new VoiceStudioInstaller({ fetch: async (input) => {
    if (String(input).includes('/releases/latest')) return Response.json({
      tag_name: 'v0.5.3', draft: false, prerelease: false,
      assets: [{ name: installerName, browser_download_url: `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${installerName}` }],
    });
    throw new Error('unexpected request');
  }});
  await assert.rejects(() => installer.resolveLatestStable(), (error: unknown) => error instanceof VoiceStudioError && error.code === 'CHECKSUM_ASSET_MISSING');
});

test('installer rejects non-GitHub download URLs', async () => {
  const installer = new VoiceStudioInstaller({ fetch: async () => Response.json({
    tag_name: 'v0.5.3', draft: false, prerelease: false,
    assets: [
      { name: installerName, browser_download_url: 'https://example.com/installer.exe' },
      { name: checksumName, browser_download_url: 'https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/checksums.txt' },
    ],
  }) });
  await assert.rejects(() => installer.resolveLatestStable(), (error: unknown) => error instanceof VoiceStudioError && error.code === 'INSTALLER_URL_INVALID');
});
