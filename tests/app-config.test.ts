import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { APP_PATHS, PROJECT_ROOT } from '../src/app/config.js';
import {
  ACTIVE_DOCUMENT_NAMES,
  loadActiveDocumentsFromRootForTest,
} from '../src/app/documents.js';

test('application paths derive from the single fixed Windows project root', () => {
  assert.equal(PROJECT_ROOT, String.raw`D:\coding\Short-auto`);
  assert.deepEqual(APP_PATHS, {
    projectRoot: PROJECT_ROOT,
    docs: win32.join(PROJECT_ROOT, 'docs'),
    data: win32.join(PROJECT_ROOT, 'data'),
    assets: win32.join(PROJECT_ROOT, 'assets'),
    output: win32.join(PROJECT_ROOT, 'output'),
    temp: win32.join(PROJECT_ROOT, 'temp'),
  });
});

function createDocsFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'short-auto-docs-'));
  for (const name of ACTIVE_DOCUMENT_NAMES) {
    writeFileSync(join(root, name), `content:${name}`, 'utf8');
  }
  return root;
}

test('active document loader reads only the exact allowlist and excludes archive', (t) => {
  const root = createDocsFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const archive = join(root, 'archive');
  mkdirSync(archive);
  writeFileSync(join(archive, 'obsolete.md'), 'must not load', 'utf8');
  writeFileSync(join(root, 'unlisted.md'), 'must not load', 'utf8');

  const documents = loadActiveDocumentsFromRootForTest(root);
  assert.equal(documents.length, 12);
  assert.deepEqual(
    documents.map(({ name }) => name),
    [...ACTIVE_DOCUMENT_NAMES],
  );
  assert.ok(documents.every(({ path }) => !path.includes(`${join(root, 'archive')}`)));
  assert.ok(documents.every(({ content }) => content.startsWith('content:')));
});

test('active document loader fails when any required document is missing', (t) => {
  const root = createDocsFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const missing = ACTIVE_DOCUMENT_NAMES[4];
  rmSync(join(root, missing));

  assert.throws(
    () => loadActiveDocumentsFromRootForTest(root),
    new RegExp(`Required active document is missing or unreadable: ${missing}`),
  );
});
