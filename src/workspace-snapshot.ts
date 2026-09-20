import { z } from 'zod';
import { WorkspaceSchema, validateWorkspace } from './validation.js';
import type { Diagnostic, Workspace } from './validation.js';

/** The only snapshot envelope version currently understood by Core. */
export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const WorkspaceSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_SNAPSHOT_SCHEMA_VERSION),
  revision: z.number().int().nonnegative().safe(),
  workspace: WorkspaceSchema,
});

export type WorkspaceSnapshot = {
  schemaVersion: typeof WORKSPACE_SNAPSHOT_SCHEMA_VERSION;
  revision: number;
  workspace: Workspace;
};

export type WorkspaceSnapshotDiagnostic = Diagnostic;

export type WorkspaceSnapshotResult =
  | { valid: true; snapshot: WorkspaceSnapshot; diagnostics: [] }
  | { valid: false; diagnostics: WorkspaceSnapshotDiagnostic[] };

const diagnostic = (code: string, path: string, message: string): WorkspaceSnapshotDiagnostic => ({
  severity: 'error',
  code,
  path,
  message,
});

function envelopeDiagnostics(error: z.ZodError): WorkspaceSnapshotDiagnostic[] {
  const diagnostics: WorkspaceSnapshotDiagnostic[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of [...issue.keys].sort()) diagnostics.push(diagnostic('UNKNOWN_FIELD', path ? `${path}.${key}` : key, 'Unknown field'));
    } else if (path === 'schemaVersion') {
      diagnostics.push(diagnostic('UNSUPPORTED_SCHEMA_VERSION', path, 'schemaVersion must be 1'));
    } else if (path === 'revision') {
      diagnostics.push(diagnostic('INVALID_REVISION', path, 'revision must be a nonnegative safe integer'));
    } else if (path === 'workspace' || path.startsWith('workspace.')) {
      const code = issue.code === 'invalid_type' && issue.input === undefined ? 'MISSING_FIELD' : 'WORKSPACE_SCHEMA';
      diagnostics.push(diagnostic(code, path, code === 'MISSING_FIELD' ? 'Required field is missing' : 'Workspace does not match its schema'));
    } else {
      const code = issue.code === 'invalid_type' && issue.input === undefined ? 'MISSING_FIELD' : 'SNAPSHOT_SCHEMA';
      diagnostics.push(diagnostic(code, path, code === 'MISSING_FIELD' ? 'Required field is missing' : 'Snapshot does not match its schema'));
    }
  }
  return diagnostics.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

/**
 * Validates a serialized workspace snapshot without I/O or other side effects.
 * Successful results contain a deep clone, so callers may safely mutate it.
 */
export function parseWorkspaceSnapshot(input: unknown): WorkspaceSnapshotResult {
  const parsed = WorkspaceSnapshotSchema.safeParse(input);
  if (!parsed.success) return { valid: false, diagnostics: envelopeDiagnostics(parsed.error) };

  const workspaceResult = validateWorkspace(parsed.data.workspace);
  if (!workspaceResult.valid) return { valid: false, diagnostics: workspaceResult.diagnostics };

  return {
    valid: true,
    snapshot: structuredClone(parsed.data),
    diagnostics: [],
  };
}

/** Alias that makes the validator naming explicit at call sites. */
export const validateWorkspaceSnapshot = parseWorkspaceSnapshot;
