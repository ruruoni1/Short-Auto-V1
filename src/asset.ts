import { z } from 'zod';
import { AssetRegistrySchema, ProductionSchema, OverridesSchema, IdSchema } from './models.js';
import type { Asset, Scene, Insert, Overrides } from './models.js';
import type { Diagnostic, ValidationResult } from './validation.js';

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
// Zod records enumerate inherited keys; registry membership must not do so.
const ownDictionary = (v: unknown): unknown => object(v) ? Object.fromEntries(Object.entries(v)) : v;
const own = <T>(map: Record<string, T>, id: string): T | undefined => Object.hasOwn(map, id) ? map[id] : undefined;
const schemaDiagnostics = (error: z.ZodError): Diagnostic[] => error.issues.map(i => ({ severity: 'error', code: 'ASSET_SCHEMA', path: i.path.join('.'), message: i.message }));

/** Shape only; ready is a declaration, never file verification. */
export function validateAssetRegistry(input: unknown): ValidationResult {
  const result = AssetRegistrySchema.safeParse(ownDictionary(input));
  return result.success ? { valid: true, diagnostics: [] } : { valid: false, diagnostics: schemaDiagnostics(result.error) };
}

const InputSchema = z.strictObject({
  production: z.preprocess(v => object(v) ? { ...v, assets: ownDictionary(v.assets) } : v, ProductionSchema),
  overrides: z.preprocess(v => object(v) ? { ...v, scenes: ownDictionary(v.scenes), inserts: ownDictionary(v.inserts) } : v, OverridesSchema),
});
const PolicySchema = z.strictObject({ generatedGraphicSceneIds: z.array(IdSchema).default([]) });
export interface AssetResolutionPolicy { generatedGraphicSceneIds?: string[]; }
export type AssetReferenceState = 'none' | Asset['status'];
export interface AssetRequest {
  kind: 'generate' | 'collect';
  assetId: string | null;
  reason: 'required' | 'missing' | 'rejected' | 'no_candidate';
  generation: Asset['generation'] | null;
  fulfilled: false;
}
export interface AssetSelection {
  id: string;
  requestedStrategy: Scene['visual']['strategy'] | 'insert' | 'pause';
  effectiveAssetId: string | null;
  referenceState: AssetReferenceState;
  /** Registered reference snapshot, including unused/rejected metadata. */
  referencedAsset: Asset | null;
  selectedAsset: Asset | null;
  preview: 'none' | 'asset' | 'generated_graphic' | 'text_only' | 'placeholder';
  placeholderReason: Asset['status'] | 'graphic_unavailable' | 'no_candidate' | null;
  fallbackReason: 'required' | 'missing' | 'rejected' | 'no_candidate' | 'audio_not_visual' | null;
  request: AssetRequest | null;
  fileVerification: 'not_performed';
}
export interface AssetResolutionPlan {
  scenes: (AssetSelection & { visual: Scene['visual']; visualOverride: NonNullable<Overrides['scenes'][string]['visual']> | null })[];
  inserts: AssetSelection[];
  previewAvailable: true;
  /** Only the asset data gate; approval, timeline and rendering are not checked. */
  finalAssetReadiness: ValidationResult;
  fileVerification: 'not_performed';
  renderVerification: 'not_performed';
}
export type ResolveAssetsResult =
  | { valid: true; plan: AssetResolutionPlan; diagnostics: Diagnostic[] }
  | { valid: false; plan: null; diagnostics: Diagnostic[] };

/** Pure, deterministic selection. Does not read files, generate assets or change revisions. */
export function resolveAssets(input: unknown, policy: AssetResolutionPolicy = {}): ResolveAssetsResult {
  const parsed = InputSchema.safeParse(input);
  const parsedPolicy = PolicySchema.safeParse(policy);
  if (!parsed.success || !parsedPolicy.success) return { valid: false, plan: null, diagnostics: [
    ...(!parsed.success ? schemaDiagnostics(parsed.error) : []),
    ...(!parsedPolicy.success ? schemaDiagnostics(parsedPolicy.error).map(d => ({ ...d, path: `policy.${d.path}` })) : []),
  ] };
  const { production: p, overrides: o } = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, path: string, message: string) => diagnostics.push({ severity: 'error', code, path, message });
  if (o.projectId !== p.project.id) error('ASSET_PROJECT_REF', 'overrides.projectId', 'Overrides belong to another project');
  for (const [items, path] of [[p.scenes, 'production.scenes'], [p.inserts, 'production.inserts']] as const) {
    const seen = new Set<string>();
    for (const item of items) { if (seen.has(item.id)) error('ASSET_DUPLICATE_ID', path, `Duplicate ID ${item.id}`); seen.add(item.id); }
  }
  const ref = (id: string | null | undefined, path: string) => {
    if (id != null && !own(p.assets, id)) error('ASSET_REF', path, `Unregistered asset ${id}`);
  };
  for (const s of p.scenes) {
    ref(s.visual.assetId, `production.scenes.${s.id}.visual.assetId`);
    const id = own(o.scenes, s.id)?.visual?.assetId ?? s.visual.assetId;
    if (s.visual.strategy === 'asset' && id !== null && own(p.assets, id)?.type === 'audio') error('ASSET_TYPE', `production.scenes.${s.id}`, 'Audio cannot provide a Scene visual');
  }
  for (const [id, value] of Object.entries(o.scenes)) {
    if (!p.scenes.some(s => s.id === id)) error('ASSET_SCENE_REF', `overrides.scenes.${id}`, 'Unknown scene');
    ref(value.visual?.assetId, `overrides.scenes.${id}.visual.assetId`);
  }
  for (const id of Object.keys(o.inserts)) if (!p.inserts.some(i => i.id === id)) error('ASSET_INSERT_REF', `overrides.inserts.${id}`, 'Unknown insert');
  for (const id of parsedPolicy.data.generatedGraphicSceneIds) if (!p.scenes.some(s => s.id === id)) error('ASSET_SCENE_REF', 'policy.generatedGraphicSceneIds', `Unknown scene ${id}`);
  for (const i of p.inserts) {
    const path = `production.inserts.${i.id}`;
    ref(i.assetId, `${path}.assetId`);
    const asset = i.assetId ? own(p.assets, i.assetId) : undefined;
    // MEDIA supports every registry media type, including audio. PAUSE consumes none.
    if (asset && ((i.type === 'ANIME_CLIP' && asset.type !== 'anime_clip') || (i.type === 'DRAMA_CLIP' && asset.type !== 'drama_clip'))) error('ASSET_TYPE', path, 'Clip and asset type disagree');
    const trim = own(o.inserts, i.id)?.trim ?? i.trim;
    if (asset?.durationMs !== undefined && (trim?.endMs ?? i.durationMs) > asset.durationMs) error('ASSET_DURATION', path, 'Insert exceeds declared asset duration');
  }
  if (diagnostics.length) return { valid: false, plan: null, diagnostics };
  const readiness: Diagnostic[] = [];
  const block = (code: string, path: string, message: string) => readiness.push({ severity: 'error', code, path, message });
  const base = (id: string, assetId: string | null, requestedStrategy: AssetSelection['requestedStrategy']): AssetSelection => {
    const asset = assetId === null ? null : own(p.assets, assetId)!;
    if (asset && asset.status !== 'ready') block('ASSET_NOT_READY', id, `Referenced asset ${assetId} is ${asset.status}`);
    return { id, requestedStrategy, effectiveAssetId: assetId, referenceState: asset?.status ?? 'none', referencedAsset: asset ? structuredClone(asset) : null, selectedAsset: null, preview: 'none', placeholderReason: null, fallbackReason: null, request: null, fileVerification: 'not_performed' };
  };
  const request = (s: AssetSelection): AssetRequest => ({ kind: s.referencedAsset?.generation ? 'generate' : 'collect', assetId: s.effectiveAssetId,
    reason: s.referenceState === 'none' || s.referenceState === 'ready' ? 'no_candidate' : s.referenceState,
    generation: structuredClone(s.referencedAsset?.generation ?? null), fulfilled: false });
  const placeholder = (s: AssetSelection) => {
    s.preview = 'placeholder'; s.placeholderReason = s.referenceState === 'none' || s.referenceState === 'ready' ? 'no_candidate' : s.referenceState;
    s.request = request(s);
    block('ASSET_PLACEHOLDER', s.id, 'Preview placeholder needs resolution before final output');
  };
  const select = (s: AssetSelection) => { s.preview = 'asset'; s.selectedAsset = structuredClone(s.referencedAsset); };
  const scenes = p.scenes.map(scene => {
    const override = own(o.scenes, scene.id)?.visual;
    const assetId = override?.assetId ?? scene.visual.assetId;
    const s = base(scene.id, assetId, scene.visual.strategy);
    const graphic = parsedPolicy.data.generatedGraphicSceneIds.includes(scene.id);
    const hasText = [scene.content.mainText, scene.content.subText, scene.content.jpText, scene.content.sourceText].some(t => t != null && t.trim().length > 0);
    switch (scene.visual.strategy) {
      case 'none': s.preview = 'none'; break;
      case 'text_only': s.preview = 'text_only'; break;
      case 'asset': if (s.referenceState === 'ready') select(s); else placeholder(s); break;
      case 'generated_graphic':
        if (graphic) s.preview = 'generated_graphic';
        else { s.preview = 'placeholder'; s.placeholderReason = 'graphic_unavailable'; block('ASSET_GRAPHIC_UNAVAILABLE', s.id, 'Graphic renderer capability not supplied'); }
        break;
      case 'auto':
        s.fallbackReason = s.referenceState === 'ready' ? (s.referencedAsset?.type === 'audio' ? 'audio_not_visual' : null) : s.referenceState === 'none' ? 'no_candidate' : s.referenceState;
        if (s.referenceState === 'ready' && s.referencedAsset?.type !== 'audio') select(s);
        else if (graphic) s.preview = 'generated_graphic';
        else if (hasText) s.preview = 'text_only';
        else placeholder(s);
        break;
    }
    if (s.preview === 'generated_graphic') block('ASSET_GRAPHIC_UNVERIFIED', s.id, 'Graphic selection is a plan, not generated output');
    return { ...s, visual: { strategy: scene.visual.strategy, assetId }, visualOverride: override ? structuredClone(override) : null };
  });
  const inserts = p.inserts.map((i: Insert) => {
    const s = base(i.id, i.assetId ?? null, i.type === 'PAUSE' ? 'pause' : 'insert');
    if (i.type !== 'PAUSE') { if (s.referenceState === 'ready') select(s); else placeholder(s); }
    return s;
  });
  for (const [id, asset] of Object.entries(p.assets)) if (asset.status === 'required') block('ASSET_REQUIRED', `production.assets.${id}`, 'Required registry asset is unresolved');
  if (diagnostics.some(d => d.severity === 'error')) return { valid: false, plan: null, diagnostics };
  diagnostics.push({ severity: 'warning', code: 'ASSET_FILES_UNVERIFIED', path: 'production.assets', message: 'Ready status, selections and Preview plans do not verify files or rendered output' });
  return { valid: true, diagnostics, plan: { scenes, inserts, previewAvailable: true, finalAssetReadiness: { valid: readiness.length === 0, diagnostics: readiness }, fileVerification: 'not_performed', renderVerification: 'not_performed' } };
}
