import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ArtifactDownloadRequest {
  projectRoot: string;
  destination: string;
  url: string;
  sha256: string;
  maxBytes?: number;
}

export interface ArtifactFetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ArtifactFetch = (input: string, init?: { headers?: Record<string, string> }) => Promise<ArtifactFetchResponse>;

export interface ArtifactDownloadResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  diagnostics: readonly ArtifactDownloadDiagnostic[];
}

export interface ArtifactDownloadDiagnostic {
  code: 'invalid_input' | 'invalid_path' | 'path_escape' | 'symlink_escape' | 'invalid_url' | 'fetch_failed' | 'http_error' | 'empty_response' | 'size_limit' | 'invalid_bytes' | 'hash_mismatch' | 'write_failed';
  path: string;
  message: string;
}

const SHA256 = /^[a-fA-F0-9]{64}$/;
const MAX_BYTES = 512 * 1024 * 1024;

function diagnostic(code: ArtifactDownloadDiagnostic['code'], path: string, message: string): ArtifactDownloadDiagnostic {
  return { code, path, message };
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || isAbsolute(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) && !normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
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

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true, recursive: false }).catch(() => undefined);
}

/** Downloads and atomically installs one verified GitHub artifact under projectRoot. */
export async function downloadGitHubArtifact(request: ArtifactDownloadRequest, fetcher: ArtifactFetch): Promise<ArtifactDownloadResult> {
  if (!request || typeof request.projectRoot !== 'string' || !isSafeRelativePath(request.destination) || !isOfficialGitHubUrl(request.url) || !SHA256.test(request.sha256)) {
    return { ok: false, diagnostics: [diagnostic('invalid_input', 'request', 'projectRoot, safe destination, official GitHub URL, and SHA-256 are required.')] };
  }
  const maxBytes = request.maxBytes ?? MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BYTES) return { ok: false, diagnostics: [diagnostic('size_limit', 'maxBytes', 'maxBytes must be a positive safe integer within the download limit.')] };
  let root: string;
  try {
    root = await realpath(request.projectRoot);
  } catch {
    return { ok: false, diagnostics: [diagnostic('invalid_path', 'projectRoot', 'projectRoot must resolve to an existing directory.')] };
  }
  const destination = resolve(root, request.destination.replaceAll('\\', sep));
  if (!isInside(root, destination)) return { ok: false, diagnostics: [diagnostic('path_escape', 'destination', 'Destination must remain inside projectRoot.')] };
  const part = `${destination}.part`;
  let parent: string;
  try {
    await mkdir(dirname(destination), { recursive: true });
    parent = await realpath(dirname(destination));
  } catch {
    return { ok: false, diagnostics: [diagnostic('invalid_path', 'destination', 'Destination parent could not be resolved.')] };
  }
  if (!isInside(root, parent)) return { ok: false, diagnostics: [diagnostic('symlink_escape', 'destination', 'Destination parent escapes projectRoot through a symlink.')] };
  try {
    const existing = await lstat(destination);
    if (existing.isSymbolicLink()) return { ok: false, diagnostics: [diagnostic('symlink_escape', 'destination', 'Destination must not be a symbolic link.')] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, diagnostics: [diagnostic('invalid_path', 'destination', 'Destination could not be inspected.')] };
  }
  let response: ArtifactFetchResponse;
  try {
    response = await fetcher(request.url, { headers: { Accept: 'application/octet-stream' } });
  } catch {
    return { ok: false, diagnostics: [diagnostic('fetch_failed', 'request', 'The injected artifact fetch failed.')] };
  }
  if (!response.ok) return { ok: false, diagnostics: [diagnostic('http_error', 'response', `Artifact request returned HTTP ${response.status}.`)] };
  let bytes: Buffer;
  try {
    const buffer = await response.arrayBuffer();
    bytes = Buffer.from(buffer);
  } catch {
    return { ok: false, diagnostics: [diagnostic('invalid_bytes', 'response', 'Artifact response bytes could not be read.')] };
  }
  if (bytes.length === 0) return { ok: false, diagnostics: [diagnostic('empty_response', 'response', 'Artifact response was empty.')] };
  if (bytes.length > maxBytes) return { ok: false, diagnostics: [diagnostic('size_limit', 'response', 'Artifact response exceeded maxBytes.')] };
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== request.sha256.toLowerCase()) return { ok: false, diagnostics: [diagnostic('hash_mismatch', 'sha256', 'Artifact SHA-256 did not match the expected digest.')] };
  await removeQuietly(part);
  try {
    await writeFile(part, bytes, { flag: 'wx' });
    try {
      await rename(part, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      await unlink(destination);
      await rename(part, destination);
    }
    return { ok: true, path: destination, bytes: bytes.length, diagnostics: [] };
  } catch {
    await removeQuietly(part);
    return { ok: false, diagnostics: [diagnostic('write_failed', 'destination', 'Verified artifact could not be installed.')] };
  }
}
