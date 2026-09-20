import { FileWorkspaceReader } from '../../workspace-file-reader.js';

/** Keeps startup available while requiring an explicitly configured snapshot for review. */
export function createYouTubeWorkspaceProvider(projectRoot: string, snapshotPath: string | undefined): () => unknown | Promise<unknown> {
  if (snapshotPath === undefined) return () => undefined;

  const reader = new FileWorkspaceReader(projectRoot, snapshotPath);
  return async () => {
    const result = await reader.read();
    if (!result.valid) throw new Error('Workspace snapshot is unavailable.');
    return result.snapshot.workspace;
  };
}
