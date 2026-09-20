import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { parseWorkspaceSnapshot } from './workspace-snapshot.js';
import type { WorkspaceSnapshotResult } from './workspace-snapshot.js';
import type { Diagnostic } from './validation.js';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export interface FileWorkspaceReaderOptions {
  workspaceRoot: string;
  snapshotPath: string;
  maxBytes?: number;
}

export interface WorkspaceFileReaderOptions {
  maxBytes?: number;
}

export type WorkspaceFileReaderResult = WorkspaceSnapshotResult;

function diagnostic(code: string, path: string, message: string): Diagnostic {
  return { severity: 'error', code, path, message };
}

function result(code: string, path: string, message: string): WorkspaceFileReaderResult {
  return { valid: false, diagnostics: [diagnostic(code, path, message)] };
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

function isSafeRelativeSnapshotPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  if (isAbsolute(value) || win32.isAbsolute(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  return normalized.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'));
}

function configuredMaxBytes(value: unknown): number | null {
  if (value === undefined) return DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 64 * 1024 * 1024) return null;
  return value as number;
}

/** Reads and validates one workspace snapshot under an explicit workspace root. */
export class FileWorkspaceReader {
  readonly #workspaceRoot: unknown;
  readonly #snapshotPath: unknown;
  readonly #maxBytes: unknown;

  constructor(workspaceRoot: string, snapshotPath: string, options?: WorkspaceFileReaderOptions);
  constructor(options: FileWorkspaceReaderOptions);
  constructor(
    workspaceRootOrOptions: string | FileWorkspaceReaderOptions,
    snapshotPath?: string,
    options: WorkspaceFileReaderOptions = {},
  ) {
    if (typeof workspaceRootOrOptions === 'object' && workspaceRootOrOptions !== null) {
      this.#workspaceRoot = workspaceRootOrOptions.workspaceRoot;
      this.#snapshotPath = workspaceRootOrOptions.snapshotPath;
      this.#maxBytes = workspaceRootOrOptions.maxBytes;
    } else {
      this.#workspaceRoot = workspaceRootOrOptions;
      this.#snapshotPath = snapshotPath;
      this.#maxBytes = options.maxBytes;
    }
  }

  async read(): Promise<WorkspaceFileReaderResult> {
    if (typeof this.#workspaceRoot !== 'string' || this.#workspaceRoot.length === 0) {
      return result('INVALID_WORKSPACE_ROOT', 'workspaceRoot', 'workspaceRoot must be a non-empty path.');
    }
    if (!isSafeRelativeSnapshotPath(this.#snapshotPath)) {
      return result('INVALID_SNAPSHOT_PATH', 'snapshotPath', 'snapshotPath must be a safe relative path without traversal or alternate data streams.');
    }
    const maxBytes = configuredMaxBytes(this.#maxBytes);
    if (maxBytes === null) return result('INVALID_SIZE_LIMIT', 'maxBytes', 'maxBytes must be a positive safe integer within the reader limit.');

    let root: string;
    try {
      const rootStat = await stat(this.#workspaceRoot);
      if (!rootStat.isDirectory()) return result('INVALID_WORKSPACE_ROOT', 'workspaceRoot', 'workspaceRoot must resolve to a directory.');
      root = await realpath(this.#workspaceRoot);
    } catch {
      return result('INVALID_WORKSPACE_ROOT', 'workspaceRoot', 'workspaceRoot must resolve to an existing directory.');
    }

    const candidate = resolve(root, this.#snapshotPath.replaceAll('\\', sep));
    if (!isInside(root, candidate)) return result('PATH_ESCAPE', 'snapshotPath', 'snapshotPath must remain inside workspaceRoot.');

    let resolvedFile: string;
    try {
      resolvedFile = await realpath(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return result(code === 'ENOENT' ? 'SNAPSHOT_NOT_FOUND' : 'SNAPSHOT_PATH_ERROR', 'snapshotPath', code === 'ENOENT' ? 'The workspace snapshot does not exist.' : 'The workspace snapshot path could not be resolved.');
    }
    if (!isInside(root, resolvedFile)) return result('SYMLINK_ESCAPE', 'snapshotPath', 'snapshotPath must not escape workspaceRoot through a symlink.');

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(resolvedFile, 'r');
      const before = await handle.stat();
      if (!before.isFile()) return result('SNAPSHOT_NOT_REGULAR', 'snapshotPath', 'The workspace snapshot must be a regular file.');
      const openedRealpath = await realpath(resolvedFile);
      if (!isInside(root, openedRealpath)) return result('SYMLINK_ESCAPE', 'snapshotPath', 'snapshotPath must not escape workspaceRoot through a symlink.');
      const pathStat = await stat(resolvedFile);
      if (!pathStat.isFile() || pathStat.dev !== before.dev || pathStat.ino !== before.ino) {
        return result('SNAPSHOT_CHANGED', 'snapshotPath', 'The workspace snapshot changed while it was being opened.');
      }
      if (before.size > maxBytes) return result('SNAPSHOT_TOO_LARGE', 'snapshotPath', 'The workspace snapshot exceeds maxBytes.');
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (read.bytesRead === 0) return result('SNAPSHOT_CHANGED', 'snapshotPath', 'The workspace snapshot changed while it was being read.');
        offset += read.bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return result('SNAPSHOT_CHANGED', 'snapshotPath', 'The workspace snapshot changed while it was being read.');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return result('INVALID_UTF8', 'snapshotPath', 'The workspace snapshot is not valid UTF-8.');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return result('INVALID_JSON', 'snapshotPath', 'The workspace snapshot is not valid JSON.');
      }
      return parseWorkspaceSnapshot(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return result(code === 'ENOENT' ? 'SNAPSHOT_NOT_FOUND' : 'SNAPSHOT_READ_ERROR', 'snapshotPath', code === 'ENOENT' ? 'The workspace snapshot does not exist.' : 'The workspace snapshot could not be read.');
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export async function readWorkspaceSnapshotFile(
  workspaceRoot: string,
  snapshotPath: string,
  options?: WorkspaceFileReaderOptions,
): Promise<WorkspaceFileReaderResult> {
  return new FileWorkspaceReader(workspaceRoot, snapshotPath, options).read();
}
