import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssets, validateAssetRegistry } from '../src/index.js';
import type { Asset, AssetResolutionPolicy } from '../src/index.js';
import { exampleWorkspace } from './fixtures.js';

function fixture() {
  const { production, overrides } = exampleWorkspace().projects[0]!;
  production.assets = { media: { type: 'image', status: 'ready', src: 'assets/image.png', metadata: { title: '원문', episode: '3', expression: 'こんにちは', sourceUrl: 'https://example.com/source', sourceTimecode: '00:01', publicId: 'source-1' } } };
  production.scenes[0]!.visual = { strategy: 'auto', assetId: 'media' };
  production.inserts = [];
  return { production, overrides };
}
function plan(x = fixture(), policy?: AssetResolutionPolicy) {
  const r = resolveAssets(x, policy); assert.ok(r.valid, JSON.stringify(r.diagnostics)); return r.plan;
}
function fails(x: unknown, code: string) { const r = resolveAssets(x); assert.equal(r.valid, false); assert.equal(r.plan, null); assert.ok(r.diagnostics.some(d => d.code === code), JSON.stringify(r.diagnostics)); }

for (const status of ['ready', 'required', 'missing', 'rejected'] as const) {
  test(`registry accepts ${status} as data, not file evidence`, () => {
    const asset: Asset = { type: 'image', status, ...(status === 'ready' ? { src: 'assets/fake.png' } : {}) };
    assert.equal(validateAssetRegistry({ a: asset }).valid, true);
    const x = fixture(); x.production.assets.media = asset;
    const p = plan(x); assert.equal(p.scenes[0]!.referenceState, status);
    assert.equal(p.fileVerification, 'not_performed'); assert.equal(p.renderVerification, 'not_performed');
    assert.equal(p.finalAssetReadiness.valid, status === 'ready');
  });
}
for (const invalid of [null, [], { a: { type: 'image', status: 'ready' } }, { a: { type: 'image', status: 'missing', src: '../bad' } }, { a: { type: 'image', status: 'missing', surprise: true } }]) {
  test(`reject invalid registry ${JSON.stringify(invalid)}`, () => assert.equal(validateAssetRegistry(invalid).valid, false));
}
for (const strategy of ['none', 'text_only'] as const) {
  for (const status of ['ready', 'required', 'missing', 'rejected'] as const) {
    test(`${strategy} keeps explicit strategy with ${status} override`, () => {
      const x = fixture(); x.production.scenes[0]!.visual = { strategy, assetId: null };
      x.production.assets.media!.status = status;
      x.overrides.scenes.scene_001 = { visual: { assetId: 'media', scale: 2, offsetX: 5 } };
      const p = plan(x, { generatedGraphicSceneIds: ['scene_001'] }); const s = p.scenes[0]!;
      assert.equal(s.preview, strategy); assert.equal(s.selectedAsset, null); assert.equal(s.request, null);
      assert.equal(s.effectiveAssetId, 'media'); assert.equal(s.visual.strategy, strategy); assert.equal(s.visualOverride!.scale, 2);
      assert.equal(p.finalAssetReadiness.valid, status === 'ready');
    });
  }
}
test('auto priority ready asset before graphic and text, no unrelated registry scan', () => {
  const x = fixture(); assert.equal(plan(x, { generatedGraphicSceneIds: ['scene_001'] }).scenes[0]!.preview, 'asset');
  x.production.scenes[0]!.visual.assetId = null;
  assert.equal(plan(x, { generatedGraphicSceneIds: ['scene_001'] }).scenes[0]!.preview, 'generated_graphic');
  assert.equal(plan(x).scenes[0]!.preview, 'text_only');
  x.production.scenes[0]!.content = { mainText: ' \n\t ', subText: null, jpText: null, emphasis: ['emphasis is not display content'] };
  const s = plan(x).scenes[0]!; assert.equal(s.preview, 'placeholder'); assert.equal(s.request!.kind, 'collect');
  assert.equal(s.request!.assetId, null); assert.equal(s.request!.fulfilled, false);
});
for (const status of ['required', 'missing', 'rejected'] as const) {
  test(`auto ${status} keeps provenance through graphic/text/request fallback`, () => {
    const x = fixture(); x.production.assets.media!.status = status;
    x.production.assets.media!.generation = { description: '두 사람', aspectRatio: '16:9' };
    for (const graphic of [true, false]) {
      const s = plan(x, { generatedGraphicSceneIds: graphic ? ['scene_001'] : [] }).scenes[0]!;
      assert.equal(s.preview, graphic ? 'generated_graphic' : 'text_only');
      assert.equal(s.fallbackReason, status); assert.equal(s.referencedAsset!.metadata!.publicId, 'source-1');
      assert.equal(s.selectedAsset, null); assert.equal(s.request, null);
    }
    x.production.scenes[0]!.content = { mainText: null, subText: null, jpText: null, emphasis: [] };
    const s = plan(x).scenes[0]!; assert.equal(s.placeholderReason, status); assert.equal(s.request!.kind, 'generate');
    assert.equal(s.request!.reason, status); assert.deepEqual(s.request!.generation, x.production.assets.media!.generation);
  });
  test(`explicit asset ${status} stays placeholder despite text and graphic availability`, () => {
    const x = fixture(); x.production.assets.media!.status = status; x.production.scenes[0]!.visual.strategy = 'asset';
    const s = plan(x, { generatedGraphicSceneIds: ['scene_001'] }).scenes[0]!;
    assert.equal(s.preview, 'placeholder'); assert.equal(s.placeholderReason, status); assert.equal(s.selectedAsset, null);
  });
}
test('explicit generated graphic never silently selects asset/text or claims completed output', () => {
  const x = fixture(); x.production.scenes[0]!.visual.strategy = 'generated_graphic';
  const p = plan(x); assert.equal(p.scenes[0]!.placeholderReason, 'graphic_unavailable'); assert.equal(p.finalAssetReadiness.valid, false);
  const supported = plan(x, { generatedGraphicSceneIds: ['scene_001'] });
  assert.equal(supported.scenes[0]!.preview, 'generated_graphic'); assert.equal(supported.finalAssetReadiness.valid, false);
});
for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
  test(`own-property asset lookup ${id}`, () => {
    const x = fixture(); x.production.scenes[0]!.visual.assetId = id; fails(x, 'ASSET_REF');
    x.production.assets = Object.create({ [id]: { type: 'image', status: 'ready', src: 'assets/fake.png' } }) as typeof x.production.assets;
    fails(x, 'ASSET_REF');
    Object.defineProperty(x.production.assets, id, { value: { type: 'image', status: 'ready', src: 'assets/fake.png' }, enumerable: true });
    assert.equal(plan(x).scenes[0]!.preview, 'asset');
  });
}
test('override own entries only, both original and override refs must exist', () => {
  const x = fixture();
  x.overrides.scenes = Object.create({ scene_001: { visual: { assetId: 'unknown' } } }) as typeof x.overrides.scenes;
  assert.equal(plan(x).scenes[0]!.effectiveAssetId, 'media');
  x.overrides.scenes = { scene_001: { visual: { assetId: 'unknown' } } }; fails(x, 'ASSET_REF');
  x.overrides.scenes.scene_001!.visual!.assetId = 'media'; x.production.scenes[0]!.visual.assetId = 'unknown'; fails(x, 'ASSET_REF');
});
test('effective override replaces nonrequired missing asset for readiness', () => {
  const x = fixture(); x.production.assets.old = { type: 'image', status: 'missing' }; x.production.scenes[0]!.visual.assetId = 'old';
  x.overrides.scenes.scene_001 = { visual: { assetId: 'media' } };
  assert.equal(plan(x).finalAssetReadiness.valid, true);
  x.production.assets.old.status = 'required'; assert.equal(plan(x).finalAssetReadiness.valid, false);
});
for (const type of ['ANIME_CLIP', 'DRAMA_CLIP', 'MEDIA', 'PAUSE'] as const) {
  test(`Insert ${type} compatibility and pause behavior`, () => {
    const x = fixture(); x.production.inserts = [{ id: 'i', type, timingMode: type === 'PAUSE' ? 'pause' : 'insert', assetId: 'media', anchor: { type: 'source_time', timeMs: 0 }, durationMs: 100 }];
    if (type === 'ANIME_CLIP' || type === 'DRAMA_CLIP') {
      fails(x, 'ASSET_TYPE'); x.production.assets.media!.type = type === 'ANIME_CLIP' ? 'anime_clip' : 'drama_clip';
    }
    assert.equal(plan(x).inserts[0]!.preview, type === 'PAUSE' ? 'none' : 'asset');
    x.production.assets.media!.status = 'rejected';
    assert.equal(plan(x).inserts[0]!.preview, type === 'PAUSE' ? 'none' : 'placeholder');
    assert.equal(plan(x).finalAssetReadiness.valid, false);
  });
}
test('MEDIA audio valid; explicit audio visual error and auto fallback', () => {
  const x = fixture(); x.production.assets.media!.type = 'audio';
  x.production.inserts = [{ id: 'i', type: 'MEDIA', timingMode: 'overlay', anchor: { type: 'source_time', timeMs: 0 }, assetId: 'media', durationMs: 10 }];
  assert.equal(plan(x).inserts[0]!.preview, 'asset'); assert.equal(plan(x).scenes[0]!.fallbackReason, 'audio_not_visual');
  x.production.scenes[0]!.visual.strategy = 'asset'; fails(x, 'ASSET_TYPE');
  x.production.assets.media!.status = 'missing'; fails(x, 'ASSET_TYPE');
});
for (const status of ['required', 'missing', 'rejected'] as const) {
  test(`Insert ${status} placeholder preserves status and request`, () => {
    const x = fixture(); x.production.assets.media!.status = status;
    x.production.inserts = [{ id: 'i', type: 'MEDIA', timingMode: 'overlay', anchor: { type: 'source_time', timeMs: 0 }, assetId: 'media', durationMs: 10 }];
    const p = plan(x); assert.equal(p.inserts[0]!.placeholderReason, status); assert.equal(p.inserts[0]!.request!.reason, status);
    assert.equal(p.inserts[0]!.selectedAsset, null); assert.equal(p.previewAvailable, true); assert.equal(p.finalAssetReadiness.valid, false);
  });
}
test('unregistered references fail even under explicit none/text_only and in Inserts', () => {
  for (const strategy of ['none', 'text_only'] as const) {
    const x = fixture(); x.production.scenes[0]!.visual = { strategy, assetId: 'absent' }; fails(x, 'ASSET_REF');
  }
  const x = fixture(); x.production.inserts = [{ id: 'i', type: 'MEDIA', timingMode: 'insert', anchor: { type: 'source_time', timeMs: 0 }, assetId: 'absent', durationMs: 10 }]; fails(x, 'ASSET_REF');
});
test('effective insert trim checked against declared media duration', () => {
  const x = fixture(); x.production.assets.media!.durationMs = 500;
  x.production.inserts = [{ id: 'i', type: 'MEDIA', timingMode: 'insert', anchor: { type: 'source_time', timeMs: 0 }, assetId: 'media', durationMs: 100 }];
  x.overrides.inserts.i = { trim: { startMs: 100, endMs: 501 } }; fails(x, 'ASSET_DURATION');
  x.overrides.inserts.i.trim.endMs = 500; assert.equal(plan(x).inserts[0]!.preview, 'asset');
});
test('bad schema, duplicate IDs, wrong project and unknown override/policy targets fail atomically', () => {
  fails({}, 'ASSET_SCHEMA');
  const x = fixture(); x.production.scenes.push(structuredClone(x.production.scenes[0]!)); fails(x, 'ASSET_DUPLICATE_ID'); x.production.scenes.pop();
  x.overrides.projectId = 'other'; fails(x, 'ASSET_PROJECT_REF'); x.overrides.projectId = x.production.project.id;
  x.overrides.scenes.unknown = {}; fails(x, 'ASSET_SCENE_REF'); delete x.overrides.scenes.unknown;
  x.overrides.inserts.unknown = { trim: { startMs: 0, endMs: 1 } }; fails(x, 'ASSET_INSERT_REF'); delete x.overrides.inserts.unknown;
  assert.equal(resolveAssets(x, { generatedGraphicSceneIds: ['unknown'] }).valid, false);
  assert.equal(resolveAssets(x, { generatedGraphicSceneIds: true } as unknown as AssetResolutionPolicy).valid, false);
});
test('deep frozen input unchanged; result metadata and generation detached', () => {
  const x = fixture(); x.production.assets.media!.generation = { description: '보존', aspectRatio: '16:9' };
  const before = structuredClone(x);
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(x); const p = plan(x); assert.deepEqual(x, before);
  p.scenes[0]!.selectedAsset!.metadata!.title = 'changed'; p.scenes[0]!.referencedAsset!.generation!.description = 'changed';
  assert.deepEqual(x, before); assert.equal(plan(x).scenes[0]!.selectedAsset!.metadata!.title, '원문');
});
