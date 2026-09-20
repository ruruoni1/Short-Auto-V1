import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGitHubReleaseManifest, type GitHubFetchResponse } from '../src/app/desktop/github-release.js';

const hash = 'a'.repeat(64);
const response = (payload: unknown): GitHubFetchResponse => ({ ok: true, status: 200, json: async () => payload, text: async () => String(payload) });

test('converts a stable release and connects checksum asset hashes', async () => {
  const calls: string[] = [];
  const result = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.2.3' }, async (url) => {
    calls.push(url);
    return calls.length === 1 ? response({ tag_name: 'v1.2.3', prerelease: false, draft: false, assets: [{ name: 'Short-auto.exe', browser_download_url: 'https://github.com/ada/studio/releases/download/v1.2.3/Short-auto.exe' }, { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/ada/studio/releases/download/v1.2.3/SHA256SUMS.txt' }] }) : { ok: true, status: 200, json: async () => ({}), text: async () => `${hash}  Short-auto.exe\n` };
  });
  assert.equal(result.ok, true);
  assert.equal(result.manifest?.channel, 'stable');
  assert.equal(result.manifest?.artifacts[0]?.sha256, hash);
  assert.deepEqual(calls, ['https://api.github.com/repos/ada/studio/releases/tags/v1.2.3', 'https://github.com/ada/studio/releases/download/v1.2.3/SHA256SUMS.txt']);
});

test('maps prerelease releases to beta and omits checksum when absent', async () => {
  const result = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.2.3-beta.1' }, async () => response({ tag_name: 'v1.2.3-beta.1', prerelease: true, draft: false, assets: [{ name: 'app.exe' }] }));
  assert.equal(result.ok, true);
  assert.equal(result.manifest?.channel, 'beta');
  assert.equal(result.manifest?.artifacts[0]?.sha256, undefined);
});

test('rejects unsafe inputs, non-GitHub checksum URLs, and unsafe asset paths', async () => {
  const unsafeInput = await fetchGitHubReleaseManifest({ owner: '../ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({}));
  assert.deepEqual(unsafeInput.diagnostics.map((item) => item.code), ['invalid_input']);
  const unsafeAsset = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({ tag_name: 'v1.0.0', prerelease: false, assets: [{ name: '../app.exe' }] }));
  assert.deepEqual(unsafeAsset.diagnostics.map((item) => item.code), ['invalid_asset_path']);
  const unsafeChecksum = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({ tag_name: 'v1.0.0', prerelease: false, assets: [{ name: 'app.exe' }, { name: 'checksums.txt', browser_download_url: 'https://evil.example/checksums.txt' }] }));
  assert.deepEqual(unsafeChecksum.diagnostics.map((item) => item.code), ['invalid_url']);
});

test('rejects draft, private, malformed releases, and never exposes response secrets', async () => {
  const draft = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({ tag_name: 'v1.0.0', draft: true, assets: [{ name: 'app.exe' }] }));
  assert.deepEqual(draft.diagnostics.map((item) => item.code), ['draft_release']);
  const malformed = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({ tag_name: 'v1.0.0', private: true, assets: [{ name: 'app.exe' }], api_token: 'secret-value' }));
  assert.deepEqual(malformed.diagnostics.map((item) => item.code), ['private_release']);
  assert.equal(JSON.stringify(malformed).includes('secret-value'), false);
  const badTag = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({ tag_name: 'release-latest', assets: [{ name: 'app.exe' }] }));
  assert.deepEqual(badTag.diagnostics.map((item) => item.code), ['invalid_tag']);
});

test('rejects a release whose tag differs from the requested tag', async () => {
  const result = await fetchGitHubReleaseManifest({ owner: 'ada', repo: 'studio', tag: 'v1.0.0' }, async () => response({ tag_name: 'v1.0.1', assets: [{ name: 'app.exe' }] }));
  assert.deepEqual(result.diagnostics, [{ code: 'invalid_tag', path: 'tag_name', message: 'Release tag_name must exactly match the requested tag.' }]);
});
