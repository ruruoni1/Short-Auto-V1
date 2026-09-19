import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { VoiceStudioError } from './models.js';

const RELEASES_API = 'https://api.github.com/repos/debpalash/VoiceStudio/releases/latest';
const InstallerAssetSchema = z.object({ name: z.string().min(1), browser_download_url: z.string().url() });
const ReleaseSchema = z.object({
  tag_name: z.string().min(1),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(InstallerAssetSchema),
});

export interface VoiceStudioInstallerAsset {
  name: string;
  url: string;
  sha256: string;
}

export interface VoiceStudioRelease {
  version: string;
  installer: VoiceStudioInstallerAsset;
  checksumManifest: { name: string; url: string };
}

export interface VoiceStudioInstallerOptions {
  fetch?: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

export interface VoiceStudioDownloadOptions {
  targetDirectory: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface VoiceStudioDownloadedInstaller {
  path: string;
  bytes: number;
  sha256: string;
  downloaded: boolean;
}

function githubUrl(value: string, code: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new VoiceStudioError(code, 'VoiceStudio 배포 URL이 올바르지 않습니다.', 'invalid_response', 502, true); }
  if (url.protocol !== 'https:' || (url.hostname !== 'github.com' && url.hostname !== 'objects.githubusercontent.com')) {
    throw new VoiceStudioError(code, '허용되지 않은 VoiceStudio 배포 URL입니다.', 'invalid_response', 502, false);
  }
  return url.toString();
}

function checksum(manifest: string, assetName: string): string {
  for (const line of manifest.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+(?:\*|)(.+?)\s*$/i.exec(line.trim());
    if (match && match[2] === assetName) return match[1]!.toLowerCase();
  }
  throw new VoiceStudioError('CHECKSUM_MISSING', 'VoiceStudio 설치 파일의 SHA256을 찾을 수 없습니다.', 'invalid_response', 502, false);
}

const INSTALLER_PATTERNS = [
  /^VoiceStudio-Electron-.+-win-x64\.exe$/i,
  /^VoiceStudio_Current_User_.+_x64_en-US\.msi$/i,
  /^VoiceStudio_.+_x64_en-US\.msi$/i,
] as const;

function selectInstallerAsset(assets: z.infer<typeof InstallerAssetSchema>[], manifest: string) {
  for (const pattern of INSTALLER_PATTERNS) {
    const matches = assets.filter(asset => pattern.test(asset.name));
    if (matches.length > 1) throw new VoiceStudioError('INSTALLER_ASSET_MISSING', 'VoiceStudio Windows 설치 파일을 하나로 확인할 수 없습니다.', 'invalid_response', 502, true);
    const asset = matches[0];
    if (!asset) continue;
    try {
      return { asset, sha256: checksum(manifest, asset.name) };
    } catch (error) {
      if (error instanceof VoiceStudioError && error.code === 'CHECKSUM_MISSING') continue;
      throw error;
    }
  }
  throw new VoiceStudioError('INSTALLER_ASSET_MISSING', 'checksum이 확인되는 VoiceStudio Windows 설치 파일을 찾을 수 없습니다.', 'invalid_response', 502, true);
}

export class VoiceStudioInstaller {
  readonly #fetch: typeof fetch;
  readonly #apiUrl: string;
  readonly #timeoutMs: number;

  constructor(options: VoiceStudioInstallerOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#apiUrl = options.apiUrl ?? RELEASES_API;
    this.#timeoutMs = z.number().int().min(100).max(120_000).parse(options.timeoutMs ?? 15_000);
  }

  async resolveLatestStable(): Promise<VoiceStudioRelease> {
    const releaseResponse = await this.#request(this.#apiUrl, 'application/vnd.github+json');
    const release = ReleaseSchema.safeParse(await releaseResponse.json().catch(() => null));
    if (!release.success || release.data.draft || release.data.prerelease) {
      throw new VoiceStudioError('RELEASE_INVALID', 'VoiceStudio stable release 응답이 올바르지 않습니다.', 'invalid_response', 502, true);
    }
    const checksumAssets = release.data.assets.filter(asset => /^SHA256SUMS-Windows\.x64\.txt$/i.test(asset.name));
    if (checksumAssets.length !== 1) {
      throw new VoiceStudioError('CHECKSUM_ASSET_MISSING', 'VoiceStudio Windows SHA256 manifest를 찾을 수 없습니다.', 'invalid_response', 502, true);
    }
    const checksumAsset = checksumAssets[0]!;
    for (const asset of release.data.assets) {
      if (INSTALLER_PATTERNS.some(pattern => pattern.test(asset.name))) githubUrl(asset.browser_download_url, 'INSTALLER_URL_INVALID');
    }
    const checksumUrl = githubUrl(checksumAsset.browser_download_url, 'CHECKSUM_URL_INVALID');
    const manifestResponse = await this.#request(checksumUrl, 'text/plain');
    const manifest = await manifestResponse.text();
    const selected = selectInstallerAsset(release.data.assets, manifest);
    const installerUrl = githubUrl(selected.asset.browser_download_url, 'INSTALLER_URL_INVALID');
    return {
      version: release.data.tag_name,
      installer: { name: selected.asset.name, url: installerUrl, sha256: selected.sha256 },
      checksumManifest: { name: checksumAsset.name, url: checksumUrl },
    };
  }

  async downloadVerifiedInstaller(
    release: VoiceStudioRelease,
    options: VoiceStudioDownloadOptions,
  ): Promise<VoiceStudioDownloadedInstaller> {
    const fileName = path.basename(release.installer.name);
    if (fileName !== release.installer.name || fileName.length === 0 || fileName.includes('..')) {
      throw new VoiceStudioError('INSTALLER_NAME_INVALID', 'VoiceStudio 설치 파일 이름이 올바르지 않습니다.', 'configuration', 400, false);
    }
    const directory = path.resolve(options.targetDirectory);
    const finalPath = path.join(directory, fileName);
    const partPath = `${finalPath}.part`;
    const expected = release.installer.sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new VoiceStudioError('CHECKSUM_INVALID', 'VoiceStudio 설치 파일 SHA256 형식이 올바르지 않습니다.', 'configuration', 400, false);
    }
    const maxBytes = z.number().int().positive().max(2_000_000_000).parse(options.maxBytes ?? 1_000_000_000);
    await mkdir(directory, { recursive: true });
    const existing = await this.#hashFileIfPresent(finalPath, maxBytes);
    if (existing && existing.sha256 === expected) return { path: finalPath, ...existing, downloaded: false };
    if (existing) await rm(finalPath, { force: true });
    await rm(partPath, { force: true });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), z.number().int().min(100).max(600_000).parse(options.timeoutMs ?? 300_000));
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    let completed = false;
    try {
      const response = await this.#fetchDownload(release.installer.url, controller.signal, options.fetch ?? this.#fetch);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(declared) && declared > maxBytes) throw new VoiceStudioError('DOWNLOAD_TOO_LARGE', 'VoiceStudio 설치 파일이 허용된 크기를 초과합니다.', 'invalid_response', 502, false);
      if (!response.body) throw new VoiceStudioError('DOWNLOAD_EMPTY', 'VoiceStudio 설치 파일 응답 본문이 비어 있습니다.', 'invalid_response', 502, true);
      const file = await open(partPath, 'w');
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        const reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw new VoiceStudioError('DOWNLOAD_TOO_LARGE', 'VoiceStudio 설치 파일이 허용된 크기를 초과합니다.', 'invalid_response', 502, false);
          }
          hash.update(chunk.value);
          await file.write(chunk.value);
        }
      } finally {
        await file.close();
      }
      const actual = hash.digest('hex');
      if (actual !== expected) throw new VoiceStudioError('CHECKSUM_MISMATCH', 'VoiceStudio 설치 파일 SHA256 검증에 실패했습니다.', 'invalid_response', 502, false);
      await rename(partPath, finalPath);
      completed = true;
      return { path: finalPath, bytes, sha256: actual, downloaded: true };
    } catch (error) {
      if (error instanceof VoiceStudioError) throw error;
      throw new VoiceStudioError(
        controller.signal.aborted ? 'DOWNLOAD_CANCELLED' : 'DOWNLOAD_FAILED',
        controller.signal.aborted ? 'VoiceStudio 설치 파일 다운로드가 취소되었습니다.' : 'VoiceStudio 설치 파일 다운로드에 실패했습니다.',
        'unavailable',
        503,
        true,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (!completed) await rm(partPath, { force: true });
    }
  }

  async #request(url: string, accept: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: { Accept: accept, 'User-Agent': 'Short-auto/voice-studio-installer' },
        signal: controller.signal,
      });
      if (!response.ok) throw new VoiceStudioError(
        'RELEASE_HTTP_ERROR',
        `VoiceStudio Release 요청이 HTTP ${response.status}로 실패했습니다.`,
        'http',
        502,
        response.status >= 500,
        response.status,
      );
      return response;
    } catch (error) {
      if (error instanceof VoiceStudioError) throw error;
      throw new VoiceStudioError(
        controller.signal.aborted ? 'RELEASE_TIMEOUT' : 'RELEASE_UNAVAILABLE',
        controller.signal.aborted ? 'VoiceStudio Release 요청 시간이 초과되었습니다.' : 'VoiceStudio Release에 연결할 수 없습니다.',
        'unavailable',
        503,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async #fetchDownload(url: string, signal: AbortSignal, fetcher: typeof fetch): Promise<Response> {
    const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/octet-stream', 'User-Agent': 'Short-auto/voice-studio-installer' }, signal });
    if (!response.ok) throw new VoiceStudioError(
      'DOWNLOAD_HTTP_ERROR',
      `VoiceStudio 설치 파일 요청이 HTTP ${response.status}로 실패했습니다.`,
      'http',
      502,
      response.status >= 500,
      response.status,
    );
    return response;
  }

  async #hashFileIfPresent(filePath: string, maxBytes: number): Promise<{ bytes: number; sha256: string } | undefined> {
    let size: number;
    try { size = (await stat(filePath)).size; }
    catch { return undefined; }
    if (size > maxBytes) throw new VoiceStudioError('DOWNLOAD_TOO_LARGE', '기존 VoiceStudio 설치 파일이 허용된 크기를 초과합니다.', 'invalid_response', 502, false);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(filePath)) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    return { bytes, sha256: hash.digest('hex') };
  }
}
