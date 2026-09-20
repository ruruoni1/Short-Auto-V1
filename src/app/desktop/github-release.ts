import { type ContractDiagnostic, type ReleaseManifest, validateReleaseManifest } from './contract.js';

export interface GitHubReleaseRequest {
  owner: string;
  repo: string;
  tag: string;
}

export interface GitHubFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type GitHubFetch = (input: string, init?: { headers?: Record<string, string> }) => Promise<GitHubFetchResponse>;

export interface GitHubReleaseResult {
  ok: boolean;
  manifest?: ReleaseManifest;
  diagnostics: readonly GitHubReleaseDiagnostic[];
}

export interface GitHubReleaseDiagnostic {
  code: 'invalid_input' | 'invalid_url' | 'fetch_failed' | 'http_error' | 'invalid_response' | 'draft_release' | 'private_release' | 'invalid_tag' | 'invalid_asset_path' | 'invalid_checksum' | 'invalid_manifest';
  path: string;
  message: string;
  details?: readonly ContractDiagnostic[];
}

interface GitHubAsset {
  name: string;
  browser_download_url?: string;
}

const OWNER_OR_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;

function diagnostic(code: GitHubReleaseDiagnostic['code'], path: string, message: string, details?: readonly ContractDiagnostic[]): GitHubReleaseDiagnostic {
  return { code, path, message, ...(details ? { details } : {}) };
}

function isSafeAssetPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) && !normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function isChecksumAsset(name: string): boolean {
  return /(?:sha[-_]?256|checksums?)/i.test(name);
}

function isOfficialGitHubUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname === 'api.github.com');
  } catch {
    return false;
  }
}

function parseChecksumText(text: string): Map<string, string> | undefined {
  const checksums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?<hash>[a-fA-F0-9]{64})\s+\*?(?<name>.+?)\s*$/.exec(trimmed);
    if (!match?.groups?.hash || !match.groups.name) continue;
    checksums.set(match.groups.name.replaceAll('\\', '/').replace(/^\.\//, ''), match.groups.hash.toLowerCase());
  }
  return checksums.size > 0 ? checksums : undefined;
}

function checksumForAsset(checksums: Map<string, string>, name: string): string | undefined {
  const normalized = name.replaceAll('\\', '/');
  const exact = checksums.get(normalized);
  if (exact) return exact;
  const basename = normalized.split('/').at(-1);
  if (!basename) return undefined;
  const matches = [...checksums.entries()].filter(([candidate]) => candidate.split('/').at(-1) === basename);
  return matches.length === 1 ? matches[0]![1] : undefined;
}

function asAssets(value: unknown): GitHubAsset[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const assets: GitHubAsset[] = [];
  for (const asset of value) {
    if (!asset || typeof asset !== 'object' || typeof (asset as { name?: unknown }).name !== 'string') return undefined;
    const record = asset as { name: string; browser_download_url?: unknown };
    assets.push({ name: record.name, ...(typeof record.browser_download_url === 'string' ? { browser_download_url: record.browser_download_url } : {}) });
  }
  return assets;
}

/** Reads one injected GitHub Releases response and converts it to the pure release contract. */
export async function fetchGitHubReleaseManifest(request: GitHubReleaseRequest, fetcher: GitHubFetch): Promise<GitHubReleaseResult> {
  const diagnostics: GitHubReleaseDiagnostic[] = [];
  if (!request || !OWNER_OR_REPO.test(request.owner) || !OWNER_OR_REPO.test(request.repo) || !SAFE_TAG.test(request.tag)) {
    return { ok: false, diagnostics: [diagnostic('invalid_input', 'request', 'owner, repo, and tag must be safe non-empty GitHub path segments.')] };
  }
  const endpoint = `https://api.github.com/repos/${request.owner}/${request.repo}/releases/tags/${encodeURIComponent(request.tag)}`;
  if (!endpoint.startsWith('https://api.github.com/repos/')) return { ok: false, diagnostics: [diagnostic('invalid_url', 'url', 'Only the official GitHub API URL is allowed.')] };
  let response: GitHubFetchResponse;
  try {
    response = await fetcher(endpoint, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    return { ok: false, diagnostics: [diagnostic('fetch_failed', 'request', 'The injected GitHub fetch failed.')] };
  }
  if (!response.ok) return { ok: false, diagnostics: [diagnostic('http_error', 'response', `GitHub API returned HTTP ${response.status}.`)] };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, diagnostics: [diagnostic('invalid_response', 'response', 'GitHub API response was not valid JSON.')] };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, diagnostics: [diagnostic('invalid_response', 'response', 'GitHub release response must be an object.')] };
  const release = payload as Record<string, unknown>;
  if (release.draft === true) diagnostics.push(diagnostic('draft_release', 'draft', 'Draft releases cannot be used for updates.'));
  if (release.private === true) diagnostics.push(diagnostic('private_release', 'private', 'Private releases cannot be used for updates.'));
  const tagName = release.tag_name;
  if (typeof tagName !== 'string' || !VERSION_TAG.test(tagName)) diagnostics.push(diagnostic('invalid_tag', 'tag_name', 'Release tag_name must be v followed by a semantic version.'));
  else if (tagName !== request.tag) diagnostics.push(diagnostic('invalid_tag', 'tag_name', 'Release tag_name must exactly match the requested tag.'));
  const assets = asAssets(release.assets);
  if (!assets || assets.length === 0) diagnostics.push(diagnostic('invalid_response', 'assets', 'GitHub release must contain an assets array.'));
  if (diagnostics.length > 0 || !assets || typeof tagName !== 'string' || !VERSION_TAG.test(tagName)) return { ok: false, diagnostics };
  for (const asset of assets) if (!isSafeAssetPath(asset.name)) diagnostics.push(diagnostic('invalid_asset_path', 'assets', 'Release asset names must be safe relative paths.'));
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const checksumAsset = assets.find((asset) => isChecksumAsset(asset.name));
  const artifactAssets = assets.filter((asset) => asset !== checksumAsset);
  if (artifactAssets.length === 0) return { ok: false, diagnostics: [diagnostic('invalid_response', 'assets', 'Release must contain at least one non-checksum artifact.')] };
  const checksums = new Map<string, string>();
  if (checksumAsset) {
    if (!checksumAsset.browser_download_url || !isOfficialGitHubUrl(checksumAsset.browser_download_url)) return { ok: false, diagnostics: [diagnostic('invalid_url', 'assets', 'Checksum asset URL must be an official GitHub HTTPS URL.')] };
    let checksumResponse: GitHubFetchResponse;
    try {
      checksumResponse = await fetcher(checksumAsset.browser_download_url, { headers: { Accept: 'application/octet-stream' } });
    } catch {
      return { ok: false, diagnostics: [diagnostic('fetch_failed', 'checksum', 'The injected checksum fetch failed.')] };
    }
    if (!checksumResponse.ok) return { ok: false, diagnostics: [diagnostic('http_error', 'checksum', `GitHub checksum asset returned HTTP ${checksumResponse.status}.`)] };
    try {
      const parsed = parseChecksumText(await checksumResponse.text());
      if (!parsed) return { ok: false, diagnostics: [diagnostic('invalid_checksum', 'checksum', 'Checksum asset did not contain SHA-256 entries.')] };
      for (const [name, hash] of parsed) if (SHA256.test(hash)) checksums.set(name, hash);
    } catch {
      return { ok: false, diagnostics: [diagnostic('invalid_checksum', 'checksum', 'Checksum asset could not be read.')] };
    }
  }
  const candidate = {
    version: tagName.slice(1),
    tag: tagName,
    channel: release.prerelease === true ? 'beta' : 'stable',
    artifacts: artifactAssets.map((asset) => ({ path: asset.name, ...(checksumForAsset(checksums, asset.name) ? { sha256: checksumForAsset(checksums, asset.name) } : {}) })),
  };
  const manifestResult = validateReleaseManifest(candidate);
  if (!manifestResult.ok || !manifestResult.value) return { ok: false, diagnostics: [diagnostic('invalid_manifest', 'manifest', 'Converted release manifest failed validation.', manifestResult.diagnostics)] };
  return { ok: true, manifest: manifestResult.value, diagnostics: [] };
}
