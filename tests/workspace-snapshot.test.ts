import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleWorkspace } from './fixtures.js';
import { parseWorkspaceSnapshot, validateWorkspaceSnapshot } from '../src/index.js';

function validInput() {
  return { schemaVersion: 1 as const, revision: 7, workspace: exampleWorkspace() };
}

test('valid snapshot round-trips as an immutable deep clone', () => {
  const input = validInput();
  const before = structuredClone(input);
  const result = parseWorkspaceSnapshot(input);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.snapshot, input);
  assert.notEqual(result.snapshot, input);
  assert.notEqual(result.snapshot.workspace, input.workspace);
  result.snapshot.workspace.projects[0]!.production.project.title = 'changed clone';
  assert.equal(input.workspace.projects[0]!.production.project.title, before.workspace.projects[0]!.production.project.title);
  assert.deepEqual(input, before);
});

test('unsupported schema version has a stable code and path', () => {
  const result = parseWorkspaceSnapshot({ ...validInput(), schemaVersion: 2 });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(result.diagnostics, [{ severity: 'error', code: 'UNSUPPORTED_SCHEMA_VERSION', path: 'schemaVersion', message: 'schemaVersion must be 1' }]);
});

test('revision must be a nonnegative safe integer', () => {
  for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '1']) {
    const result = parseWorkspaceSnapshot({ ...validInput(), revision });
    assert.equal(result.valid, false);
    if (!result.valid) assert.ok(result.diagnostics.some(d => d.code === 'INVALID_REVISION' && d.path === 'revision'));
  }
});

test('snapshot and nested unknown fields are rejected deterministically', () => {
  const input = validInput() as any;
  input.extra = true;
  input.workspace.extra = true;
  const result = validateWorkspaceSnapshot(input);
  assert.equal(result.valid, false);
  if (!result.valid) assert.deepEqual(result.diagnostics, [
    { severity: 'error', code: 'UNKNOWN_FIELD', path: 'extra', message: 'Unknown field' },
    { severity: 'error', code: 'UNKNOWN_FIELD', path: 'workspace.extra', message: 'Unknown field' },
  ]);
});

test('malformed workspace reports a workspace path without throwing', () => {
  const result = parseWorkspaceSnapshot({ ...validInput(), workspace: {} });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every(d => d.path.startsWith('workspace')));
  }
});

test('cross-reference failures are returned from the existing workspace validator', () => {
  const input = validInput();
  input.workspace.projects[0]!.production.project.channelPack = 'missing-pack';
  const result = parseWorkspaceSnapshot(input);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.diagnostics.some(d => d.code === 'PACK_REF' && d.path === 'projects.0.production.project'));
});

test('invalid inputs are never mutated', () => {
  const input = validInput() as any;
  input.workspace.projects[0]!.production.project.channelPack = 'missing-pack';
  const before = structuredClone(input);
  parseWorkspaceSnapshot(input);
  assert.deepEqual(input, before);
});
