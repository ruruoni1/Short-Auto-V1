import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorkspace, checkFinalRenderReadiness, ProductionSchema, PublishingResultSchema, ResolvedTimelineSchema, AnalyticsSnapshotSchema } from '../src/index.js';
import type { Workspace } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

test('Long and derived Short JSON are valid preview data, immutable during validation', () => {
  const w: unknown = JSON.parse(readFileSync(new URL('../examples/workspace.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(w); assert.equal(validateWorkspace(w).valid, true); assert.equal(JSON.stringify(w), before);
});
const cases: [string, string, (w: Workspace) => void][] = [
  ['profile mismatch', 'PROFILE_CONTENT_TYPE', w => { w.projects[0]!.production.project.contentProfile = 'anime_discovery_short'; }],
  ['unknown pack', 'PACK_REF', w => { w.projects[0]!.production.project.channelPack = 'other'; }],
  ['duplicate project', 'DUPLICATE_ID', w => { w.projects.push(structuredClone(w.projects[0]!)); }],
  ['negative caption time', 'SCHEMA', w => { w.projects[0]!.source.captions[0]!.startMs = -1; }],
  ['reversed caption time', 'SCHEMA', w => { w.projects[0]!.source.captions[0]!.endMs = 0; }],
  ['overlapping captions', 'CAPTION_TIME', w => { w.projects[0]!.source.captions[1]!.startMs = 1; }],
  ['missing scene caption', 'CAPTION_REF', w => { w.projects[0]!.production.scenes[0]!.captionRange.end = 999; }],
  ['missing anchor caption', 'CAPTION_REF', w => { w.projects[0]!.production.inserts[0]!.anchor = { type: 'caption_after', captionId: 999 }; }],
  ['mid-caption insert', 'ANCHOR_TIME', w => { w.projects[0]!.production.inserts[0]!.anchor = { type: 'source_time', timeMs: 1000 }; }],
  ['missing asset reference', 'ASSET_REF', w => { delete w.projects[0]!.production.assets.clip01; }],
  ['asset duration', 'ASSET_DURATION', w => { w.projects[0]!.production.assets.clip01!.durationMs = 10; }],
  ['unknown override target', 'SCENE_REF', w => { w.projects[0]!.overrides.scenes.unknown = {}; }],
  ['unknown override asset', 'ASSET_REF', w => { w.projects[0]!.overrides.scenes.scene_001 = { visual: { assetId: 'unknown' } }; }],
  ['wrong override project', 'PROJECT_REF', w => { w.projects[0]!.overrides.projectId = 'other'; }],
  ['Short cannot derive from Short', 'DERIVATION', w => { w.projects[1]!.production.project.origin = { sourceType: 'derived', sourceLongProjectId: 'NZ001_S1', derivativeIndex: 1, derivativeReason: 'test' }; }],
  ['content ID is not project ID', 'CONTENT_PROJECT', w => { w.contents[0]!.productionProjectId = 'content_long_001'; }],
  ['nonreciprocal relationship', 'CONTENT_RELATION', w => { w.contents[0]!.derivedShortIds = []; }],
  ['independent/derived mismatch', 'CONTENT_PROJECT', w => { w.contents[1]!.relationship = { sourceType: 'independent' }; }],
  ['unsafe path', 'SCHEMA', w => { w.projects[0]!.production.audio.tts = '../secret.wav'; }]
];
for (const [name, code, mutate] of cases) test(name, () => { const w = exampleWorkspace(); mutate(w); const r = validateWorkspace(w); assert.equal(r.valid, false); assert.ok(r.diagnostics.some(d => d.code === code), JSON.stringify(r)); });
test('invalid enum and ID reject with property paths', () => { const p = exampleWorkspace().projects[0]!.production; const r = ProductionSchema.safeParse({ ...p, project: { ...p.project, id: '../bad', status: 'published' } }); assert.equal(r.success, false); if (!r.success) assert.equal(r.error.issues.length, 2); });
test('strict schema catches typos', () => { assert.equal(ProductionSchema.safeParse({ ...exampleWorkspace().projects[0]!.production, schemVersion: '1.0' }).success, false); });
test('overlay may cross a caption; source boundary pause is valid', () => { const w = exampleWorkspace(); const i = w.projects[0]!.production.inserts[0]!; i.timingMode = 'overlay'; i.anchor = { type: 'source_time', timeMs: 1000 }; assert.equal(validateWorkspace(w).valid, true); i.type = 'PAUSE'; i.timingMode = 'pause'; i.anchor = { type: 'source_time', timeMs: 2000 }; delete i.assetId; assert.equal(validateWorkspace(w).valid, true); });
test('independent Short is supported without orphaned parent links', () => { const w = exampleWorkspace(); w.projects[1]!.production.project.origin = { sourceType: 'independent' }; w.contents[1]!.relationship = { sourceType: 'independent' }; w.contents[0]!.derivedShortIds = []; assert.equal(validateWorkspace(w).valid, true); });
test('injected pack IDs and profile IDs work without Core changes', () => { const w = exampleWorkspace(); w.packs[0]!.id = 'custom'; for (const b of w.projects) b.production.project.channelPack = 'custom'; for (const c of w.contents) c.channelPack = 'custom'; assert.equal(validateWorkspace(w).valid, true); });
test('approval and ready assets are separate from preview validity; revisions invalidate approval', () => {
  const w = exampleWorkspace(); const b = w.projects[0]!;
  assert.equal(validateWorkspace(w).valid, true); assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, false);
  b.production.project.status = 'approved'; b.approval = { projectId: 'NZ001', productionRevision: 0, overridesRevision: 0, approvedAt: '2026-09-05T12:00:00Z', approvedBy: 'tester' };
  assert.ok(checkFinalRenderReadiness(w, 'NZ001').diagnostics.some(d => d.code === 'ASSET_NOT_READY'));
  b.production.assets.clip01 = { type: 'anime_clip', status: 'ready', src: 'assets/test.mp4', durationMs: 1000 };
  assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, true);
  b.overrides.revision++; assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, false);
  b.overrides.revision--; b.production.project.revision++; assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, false);
});
test('required and missing placeholders pass preview but fail final readiness', () => { for (const status of ['required', 'missing', 'rejected'] as const) { const w = exampleWorkspace(); w.projects[0]!.production.assets.clip01!.status = status; assert.equal(validateWorkspace(w).valid, true); assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, false); } });
test('output intervals reject negative/reversed timing and changing TTS duration', () => { assert.equal(ResolvedTimelineSchema.safeParse({ projectId: 'p', productionRevision: 0, overridesRevision: 0, durationMs: 4000, segments: [{ type: 'tts', sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 3000 }] }).success, false); });
test('publishing success needs video ID and analytics extensions remain typed', () => { assert.equal(PublishingResultSchema.safeParse({ status: 'uploaded', contentId: 'c', projectId: 'p', uploadedAt: '2026-09-05T12:00:00Z' }).success, false); assert.equal(AnalyticsSnapshotSchema.safeParse({ contentId: 'c', provider: 'youtube', videoId: 'v', collectedAt: '2026-09-05T12:00:00Z', metrics: { views: -1 }, extensions: {} }).success, false); });
test('committed malformed JSON fixture fails validation', () => { const w: unknown = JSON.parse(readFileSync(new URL('../examples/invalid-workspace.json', import.meta.url), 'utf8')); assert.equal(validateWorkspace(w).valid, false); });

for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
  for (const target of ['scene', 'insert', 'override'] as const) {
    test(`unregistered ${id} asset in ${target} returns ASSET_REF`, () => {
      const w = exampleWorkspace(); const b = w.projects[0]!;
      if (target === 'scene') b.production.scenes[0]!.visual = { strategy: 'asset', assetId: id };
      if (target === 'insert') b.production.inserts[0]!.assetId = id;
      if (target === 'override') b.overrides.scenes.scene_001 = { visual: { assetId: id } };
      const result = validateWorkspace(w);
      assert.equal(result.valid, false);
      assert.ok(result.diagnostics.some(d => d.code === 'ASSET_REF' && d.message === `Unknown asset ${id}`));
      assert.ok(checkFinalRenderReadiness(w, 'NZ001').diagnostics.some(d => d.code === 'ASSET_REF'));
    });
  }
  test(`explicitly registered ${id} asset and overrides are respected`, () => {
    const w = exampleWorkspace(); const b = w.projects[0]!;
    b.production.assets = { [id]: { type: 'anime_clip', status: 'ready', src: 'assets/test.mp4', durationMs: 1000 } };
    b.production.scenes[0]!.id = id;
    b.production.scenes[0]!.visual = { strategy: 'asset', assetId: id };
    b.production.inserts[0]!.id = id;
    b.production.inserts[0]!.assetId = id;
    b.production.project.status = 'approved';
    b.approval = { projectId: 'NZ001', productionRevision: 0, overridesRevision: 0, approvedAt: '2026-09-05T12:00:00Z', approvedBy: 'tester' };
    assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, true);
    b.overrides.scenes = { [id]: { type: 'HOOK', visual: { assetId: id } } };
    b.overrides.inserts = { [id]: { trim: { startMs: 0, endMs: 1000 } } };
    assert.equal(checkFinalRenderReadiness(w, 'NZ001').valid, true);
    w.packs[0]!.profiles[0]!.allowedSceneTypes = ['EXPLAIN'];
    assert.ok(validateWorkspace(w).diagnostics.some(d => d.code === 'SCENE_POLICY'));
    delete w.packs[0]!.profiles[0]!.allowedSceneTypes;
    b.overrides.inserts = { [id]: { trim: { startMs: 0, endMs: 1001 } } };
    assert.ok(validateWorkspace(w).diagnostics.some(d => d.code === 'ASSET_DURATION'));
  });
}
