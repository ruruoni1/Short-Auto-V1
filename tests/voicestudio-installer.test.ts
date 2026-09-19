import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceStudioInstaller } from '../src/app/voicestudio/installer.js';
import { VoiceStudioError } from '../src/app/voicestudio/models.js';

const installerName = 'VoiceStudio-Electron-0.5.3-win-x64.exe';
const checksumName = 'SHA256SUMS-Windows.x64.txt';
const sha256 = 'a'.repeat(64);

function releaseFor(url = `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${installerName}`) {
  return {
    version: 'v0.5.3',
    installer: { name: installerName, url, sha256 },
    checksumManifest: { name: checksumName, url: `https://github.com/debpalash/VoiceStudio/releases/download/v0.5.3/${checksumName}` },
  };
}

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

test('installer downloads to a part file, verifies SHA256, and renames atomically', async () => {
  const targetDirectory = await mkdtemp(join(tmpdir(), 'short-auto-installer-'));
  const bytes = new TextEncoder().encode('verified installer bytes');
  const expected = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const release = { ...releaseFor(), installer: { ...releaseFor().installer, sha256: expected } };
  const installer = new VoiceStudioInstaller({ fetch: async () => new Response(bytes) });
  const result = await installer.downloadVerifiedInstaller(release, { targetDirectory });
  assert.equal(result.downloaded, true);
  assert.equal(result.bytes, bytes.byteLength);
  assert.equal(result.sha256, expected);
  assert.deepEqual(await readdir(targetDirectory), [installerName]);
});

test('installer removes partial files on checksum failure and reuses a verified file', async () => {
  const targetDirectory = await mkdtemp(join(tmpdir(), 'short-auto-installer-'));
  const release = releaseFor();
  const installer = new VoiceStudioInstaller({ fetch: async () => new Response('wrong bytes') });
  await assert.rejects(() => installer.downloadVerifiedInstaller(release, { targetDirectory }), (error: unknown) => error instanceof VoiceStudioError && error.code === 'CHECKSUM_MISMATCH');
  assert.deepEqual(await readdir(targetDirectory), []);

  const bytes = new TextEncoder().encode('verified installer bytes');
  const expected = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const verified = { ...release, installer: { ...release.installer, sha256: expected } };
  const second = new VoiceStudioInstaller({ fetch: async () => new Response(bytes) });
  await second.downloadVerifiedInstaller(verified, { targetDirectory });
  const reused = await second.downloadVerifiedInstaller(verified, { targetDirectory });
  assert.equal(reused.downloaded, false);
});
