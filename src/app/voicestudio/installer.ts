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
    const installerAssets = release.data.assets.filter(asset => /^VoiceStudio-Electron-.+-win-x64\.exe$/i.test(asset.name));
    if (installerAssets.length !== 1) {
      throw new VoiceStudioError('INSTALLER_ASSET_MISSING', 'VoiceStudio Windows Electron 설치 파일을 하나로 확인할 수 없습니다.', 'invalid_response', 502, true);
    }
    const checksumAssets = release.data.assets.filter(asset => /^SHA256SUMS-Windows\.x64\.txt$/i.test(asset.name));
    if (checksumAssets.length !== 1) {
      throw new VoiceStudioError('CHECKSUM_ASSET_MISSING', 'VoiceStudio Windows SHA256 manifest를 찾을 수 없습니다.', 'invalid_response', 502, true);
    }
    const installer = installerAssets[0]!;
    const checksumAsset = checksumAssets[0]!;
    const installerUrl = githubUrl(installer.browser_download_url, 'INSTALLER_URL_INVALID');
    const checksumUrl = githubUrl(checksumAsset.browser_download_url, 'CHECKSUM_URL_INVALID');
    const manifestResponse = await this.#request(checksumUrl, 'text/plain');
    const manifest = await manifestResponse.text();
    return {
      version: release.data.tag_name,
      installer: { name: installer.name, url: installerUrl, sha256: checksum(manifest, installer.name) },
      checksumManifest: { name: checksumAsset.name, url: checksumUrl },
    };
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
}
