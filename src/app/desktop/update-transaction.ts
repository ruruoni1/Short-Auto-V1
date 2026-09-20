import { mkdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  type ReleaseManifest,
  type ContractDiagnostic,
  validateReleaseManifest,
} from './contract.js';
import { type ArtifactFetch, downloadGitHubArtifact } from './artifact-download.js';
import { decideDesktopUpdate } from './update-policy.js';

export interface UpdateTransactionInput {
  installRoot: string;
  workspaceRoot: string;
  currentVersion: string;
  currentChannel: 'stable' | 'beta';
  manifest: unknown;
  artifactPath: string;
  artifactUrl: string;
  fetcher: ArtifactFetch;
}

export interface UpdateTransactionResult {
  ok: boolean;
  stagedPath?: string;
  bytes?: number;
  manifest?: ReleaseManifest;
  diagnostics: readonly UpdateTransactionDiagnostic[];
}

export interface UpdateTransactionDiagnostic {
  code: 'invalid_input' | 'invalid_manifest' | 'update_unavailable' | 'root_overlap' | 'artifact_mismatch' | 'download_failed';
  path: string;
  message: string;
  details?: readonly ContractDiagnostic[];
}

function diagnostic(code: UpdateTransactionDiagnostic['code'], path: string, message: string, details?: readonly ContractDiagnostic[]): UpdateTransactionDiagnostic {
  return { code, path, message, ...(details ? { details } : {}) };
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

async function cleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

/** Stages one verified update without replacing the running application. */
export async function stageDesktopUpdate(input: UpdateTransactionInput): Promise<UpdateTransactionResult> {
  if (!input || typeof input.installRoot !== 'string' || typeof input.workspaceRoot !== 'string' || typeof input.fetcher !== 'function') {
    return { ok: false, diagnostics: [diagnostic('invalid_input', 'input', 'installRoot, workspaceRoot, and an injected fetcher are required.')] };
  }
  const manifestResult = validateReleaseManifest(input.manifest);
  if (!manifestResult.ok || !manifestResult.value) {
    return { ok: false, diagnostics: [diagnostic('invalid_manifest', 'manifest', 'Release manifest failed validation.', manifestResult.diagnostics)] };
  }
  const manifest = manifestResult.value;
  const update = decideDesktopUpdate({ currentVersion: input.currentVersion, currentChannel: input.currentChannel, manifest });
  if (!update.ok || !update.manifest) {
    return { ok: false, diagnostics: [diagnostic('update_unavailable', 'manifest', 'Update policy input is invalid.')] };
  }
  if (!update.shouldUpdate) return { ok: false, diagnostics: [diagnostic('update_unavailable', 'manifest', `Update is not available: ${update.reason}.`)] };
  const artifact = manifest.artifacts.find((candidate) => candidate.path === input.artifactPath);
  if (!artifact || (artifact.sha256 ?? '') === '') return { ok: false, diagnostics: [diagnostic('artifact_mismatch', 'artifactPath', 'Selected artifact path must match a manifest artifact with a SHA-256 digest.')] };
  const artifactSha256 = artifact.sha256;
  if (!artifactSha256) return { ok: false, diagnostics: [diagnostic('artifact_mismatch', 'artifactPath', 'Selected artifact must include a SHA-256 digest.')] };
  if (manifest.tag !== `v${manifest.version}` || !['stable', 'beta'].includes(manifest.channel)) return { ok: false, diagnostics: [diagnostic('invalid_manifest', 'manifest', 'Manifest version, tag, and channel are inconsistent.')] };
  let installRoot: string;
  let workspaceRoot: string;
  try {
    installRoot = await realpath(input.installRoot);
    workspaceRoot = await realpath(input.workspaceRoot);
  } catch {
    return { ok: false, diagnostics: [diagnostic('invalid_input', 'roots', 'installRoot and workspaceRoot must resolve to existing directories.')] };
  }
  if (inside(installRoot, workspaceRoot) || inside(workspaceRoot, installRoot)) return { ok: false, diagnostics: [diagnostic('root_overlap', 'roots', 'installRoot and workspaceRoot must remain separate.')] };
  const stagingRoot = resolve(installRoot, '.updates', manifest.version);
  if (!inside(installRoot, stagingRoot) || inside(workspaceRoot, stagingRoot)) return { ok: false, diagnostics: [diagnostic('root_overlap', 'stagingRoot', 'Update staging must remain inside installRoot and outside workspaceRoot.')] };
  try { await mkdir(stagingRoot, { recursive: true }); } catch { return { ok: false, diagnostics: [diagnostic('download_failed', 'stagingRoot', 'Update staging directory could not be created.')] }; }
  const result = await downloadGitHubArtifact({ projectRoot: stagingRoot, destination: artifact.path, url: input.artifactUrl, sha256: artifactSha256 }, input.fetcher);
  if (!result.ok || !result.path || result.bytes === undefined) {
    await cleanup(stagingRoot);
    return { ok: false, diagnostics: [diagnostic('download_failed', 'artifact', 'Update artifact staging failed.', result.diagnostics as readonly ContractDiagnostic[])] };
  }
  return { ok: true, stagedPath: result.path, bytes: result.bytes, manifest, diagnostics: [] };
}
