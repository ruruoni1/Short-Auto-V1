import { mkdirSync, writeFileSync } from 'node:fs';
import { exampleWorkspace } from './fixtures.js';
mkdirSync('examples', { recursive: true });
const w = exampleWorkspace();
writeFileSync('examples/workspace.json', JSON.stringify(w, null, 2) + '\n');
const invalid = structuredClone(w); invalid.projects[0]!.production.inserts[0]!.anchor = { type: 'source_time', timeMs: 1000 };
writeFileSync('examples/invalid-workspace.json', JSON.stringify(invalid, null, 2) + '\n');
