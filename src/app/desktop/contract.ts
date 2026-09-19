import { posix, win32 } from 'node:path';

export type ReleaseChannel = 'stable' | 'beta';

export interface DesktopWorkspaceLayout {
  installRoot: string;
  workspaceRoot: string;
  projects: string;
  presets: string;
  cache: string;
  exports: string;
}

export interface DesktopWorkspaceRoots {
  /** A user-scoped Documents root, or an equivalent platform-provided root. */
  documentsRoot: string;
  /** The application install directory. It must not be inside the workspace. */
  installRoot: string;
  workspaceName?: string;
}

export interface ReleaseArtifact {
  path: string;
  sha256?: string;
}

export interface ReleaseManifest {
  version: string;
  tag: string;
  channel: ReleaseChannel;
  artifacts: readonly ReleaseArtifact[];
}

export type DiagnosticCode =
  | 'invalid_input'
  | 'invalid_root'
  | 'workspace_install_overlap'
  | 'invalid_artifact_path'
  | 'invalid_version'
  | 'invalid_tag'
  | 'invalid_channel'
  | 'invalid_artifacts'
  | 'invalid_hash'
  | 'secret_like_field';

export interface ContractDiagnostic {
  code: DiagnosticCode;
  path: string;
  message: string;
}

export interface DesktopValidationResult<T> {
  ok: boolean;
  diagnostics: readonly ContractDiagnostic[];
  value?: T;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const SECRET_FIELD = /(?:api.?key|credential|password|private.?key|secret|token|access.?key|refresh.?token)/i;

function pathApi(root: string) {
  return /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\') ? win32 : posix;
}

function cleanRoot(value: unknown, field: string, diagnostics: ContractDiagnostic[]): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    diagnostics.push({ code: 'invalid_root', path: field, message: `${field} must be a non-empty path.` });
    return undefined;
  }
  const api = pathApi(value);
  const resolved = api.resolve(value);
  if (api.relative(api.parse(resolved).root, resolved) === '') {
    return resolved;
  }
  return resolved.replace(/[\\/]$/, '');
}

function containsPath(parent: string, child: string, api: typeof posix): boolean {
  const relative = api.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
}

/** Purely derives the stable user-data layout; it never creates directories. */
export function deriveDesktopWorkspaceLayout(input: DesktopWorkspaceRoots): DesktopWorkspaceLayout {
  const diagnostics: ContractDiagnostic[] = [];
  const documentsRoot = cleanRoot(input?.documentsRoot, 'documentsRoot', diagnostics);
  const installRoot = cleanRoot(input?.installRoot, 'installRoot', diagnostics);
  if (diagnostics.length > 0 || !documentsRoot || !installRoot) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join(' '));
  }
  const api = pathApi(documentsRoot);
  const name = input.workspaceName ?? 'NihonZupZupStudio';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('workspaceName must contain only letters, numbers, dots, underscores, or hyphens.');
  }
  const workspaceRoot = api.join(documentsRoot, name);
  if (containsPath(workspaceRoot, installRoot, api) || containsPath(installRoot, workspaceRoot, api)) {
    throw new Error('installRoot and workspaceRoot must remain separate.');
  }
  return Object.freeze({
    installRoot,
    workspaceRoot,
    projects: api.join(workspaceRoot, 'projects'),
    presets: api.join(workspaceRoot, 'presets'),
    cache: api.join(workspaceRoot, 'cache'),
    exports: api.join(workspaceRoot, 'exports'),
  });
}

function add(diagnostics: ContractDiagnostic[], code: DiagnosticCode, path: string, message: string) {
  diagnostics.push({ code, path, message });
}

function validateArtifactPath(value: unknown, path: string, diagnostics: ContractDiagnostic[]): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    add(diagnostics, 'invalid_artifact_path', path, 'Artifact path must be a non-empty relative path.');
    return false;
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    add(diagnostics, 'invalid_artifact_path', path, 'Artifact path must not be absolute or traverse its release directory.');
    return false;
  }
  if (normalized.split('/').some((segment) => segment === '' || segment === '.')) {
    add(diagnostics, 'invalid_artifact_path', path, 'Artifact path contains an empty or current-directory segment.');
    return false;
  }
  return true;
}

function scanSecrets(value: unknown, path: string, diagnostics: ContractDiagnostic[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecrets(item, `${path}[${index}]`, diagnostics));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = path ? `${path}.${key}` : key;
      if (SECRET_FIELD.test(key)) add(diagnostics, 'secret_like_field', itemPath, 'Release metadata must not contain secret-like fields.');
      scanSecrets(item, itemPath, diagnostics);
    }
  }
}

/** Validates release metadata without reading files or contacting a release service. */
export function validateReleaseManifest(input: unknown): DesktopValidationResult<ReleaseManifest> {
  const diagnostics: ContractDiagnostic[] = [];
  scanSecrets(input, '', diagnostics);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    add(diagnostics, 'invalid_input', '', 'Release manifest must be an object.');
    return { ok: false, diagnostics };
  }
  const candidate = input as Record<string, unknown>;
  const version = candidate.version;
  const tag = candidate.tag;
  const channel = candidate.channel;
  const artifacts = candidate.artifacts;
  if (typeof version !== 'string' || !VERSION.test(version)) add(diagnostics, 'invalid_version', 'version', 'Version must use semantic versioning, such as 1.2.3 or 1.2.3-beta.1.');
  if (typeof tag !== 'string' || tag !== `v${String(version)}`) add(diagnostics, 'invalid_tag', 'tag', 'Tag must exactly equal v plus the manifest version.');
  if (channel !== 'stable' && channel !== 'beta') add(diagnostics, 'invalid_channel', 'channel', 'Channel must be stable or beta.');
  if (!Array.isArray(artifacts) || artifacts.length === 0) add(diagnostics, 'invalid_artifacts', 'artifacts', 'At least one release artifact is required.');
  const normalizedArtifacts: ReleaseArtifact[] = [];
  if (Array.isArray(artifacts)) {
    artifacts.forEach((artifact, index) => {
      const path = `artifacts[${index}]`;
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
        add(diagnostics, 'invalid_artifacts', path, 'Each artifact must be an object.');
        return;
      }
      const record = artifact as Record<string, unknown>;
      const validPath = validateArtifactPath(record.path, `${path}.path`, diagnostics);
      if (record.sha256 !== undefined && (typeof record.sha256 !== 'string' || !SHA256.test(record.sha256))) add(diagnostics, 'invalid_hash', `${path}.sha256`, 'sha256 must be a 64-character hexadecimal digest.');
      if (validPath) normalizedArtifacts.push({ path: record.path as string, ...(record.sha256 === undefined ? {} : { sha256: record.sha256 as string }) });
    });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, diagnostics: [], value: Object.freeze({ version: version as string, tag: tag as string, channel: channel as ReleaseChannel, artifacts: Object.freeze(normalizedArtifacts) }) };
}
