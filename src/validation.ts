import { z } from 'zod';
import { ProductionSchema, SourceTimelineSchema, OverridesSchema, ChannelPackSchema, ContentRecordSchema, ApprovalSchema } from './models.js';
import type { Production, ContentRecord } from './models.js';

export interface Diagnostic { severity: 'error' | 'warning'; code: string; path: string; message: string; }
export interface ValidationResult { valid: boolean; diagnostics: Diagnostic[]; }
export const ProjectBundleSchema = z.strictObject({ production: ProductionSchema, source: SourceTimelineSchema, overrides: OverridesSchema, approval: ApprovalSchema.optional() });
export type ProjectBundle = z.infer<typeof ProjectBundleSchema>;
export const WorkspaceSchema = z.strictObject({ packs: z.array(ChannelPackSchema), projects: z.array(ProjectBundleSchema), contents: z.array(ContentRecordSchema) });
export type Workspace = z.infer<typeof WorkspaceSchema>;

function ownEntry<T>(dictionary: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(dictionary, id) ? dictionary[id] : undefined;
}

/** Validates JSON shape first, then references. Never mutates source data or resolves timing. */
export function validateWorkspace(input: unknown): ValidationResult {
  const parsed = WorkspaceSchema.safeParse(input);
  if (!parsed.success) return { valid: false, diagnostics: parsed.error.issues.map(i => ({ severity: 'error', code: 'SCHEMA', path: i.path.join('.'), message: i.message })) };
  const w = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, path: string, message: string) => { diagnostics.push({ severity: 'error', code, path, message }); };
  const warning = (code: string, path: string, message: string) => { diagnostics.push({ severity: 'warning', code, path, message }); };
  const unique = (ids: (string | number)[], path: string) => { const seen = new Set(); ids.forEach((id, i) => { if (seen.has(id)) error('DUPLICATE_ID', `${path}.${i}`, `Duplicate ID ${id}`); seen.add(id); }); };
  unique(w.packs.map(p => p.id), 'packs'); unique(w.projects.map(p => p.production.project.id), 'projects'); unique(w.contents.map(c => c.id), 'contents');
  for (const pack of w.packs) {
    unique(pack.profiles.map(p => p.id), `packs.${pack.id}.profiles`); unique(pack.themes.map(t => t.id), `packs.${pack.id}.themes`);
    for (const p of pack.profiles) for (const id of p.derivativePolicy?.targetProfileIds ?? []) if (!pack.profiles.some(t => t.id === id && t.contentType.endsWith('_short'))) error('PROFILE_REF', `packs.${pack.id}.${p.id}`, `Unknown Short profile ${id}`);
  }
  const checkProfile = (item: Production['project'] | ContentRecord, path: string) => {
    const pack = w.packs.find(p => p.id === item.channelPack);
    const profile = pack?.profiles.find(p => p.id === item.contentProfile);
    if (!pack) error('PACK_REF', path, `Unknown pack ${item.channelPack}`);
    else if (!profile) error('PROFILE_REF', path, `Unknown profile ${item.contentProfile}`);
    else if (profile.contentType !== item.contentType) error('PROFILE_CONTENT_TYPE', path, 'Profile and contentType disagree');
    return { pack, profile };
  };
  for (const [index, bundle] of w.projects.entries()) {
    const { production: p, source: s, overrides: o } = bundle;
    const path = `projects.${index}`;
    const { pack, profile } = checkProfile(p.project, `${path}.production.project`);
    if (pack && !pack.themes.some(t => t.id === p.settings.theme)) error('THEME_REF', path, `Unknown theme ${p.settings.theme}`);
    if (o.projectId !== p.project.id) error('PROJECT_REF', `${path}.overrides.projectId`, 'Overrides belong to another project');
    if (bundle.approval && bundle.approval.projectId !== p.project.id) error('PROJECT_REF', `${path}.approval`, 'Approval belongs to another project');
    unique(s.captions.map(c => c.id), `${path}.source.captions`); unique(p.scenes.map(c => c.id), `${path}.production.scenes`); unique(p.inserts.map(c => c.id), `${path}.production.inserts`);
    let end = 0; let previousId = 0;
    for (const c of s.captions) {
      if (c.startMs < end || c.endMs > s.durationMs || c.id <= previousId) error('CAPTION_TIME', `${path}.source.captions`, 'Cues must be ordered, nonoverlapping and inside source duration, with increasing IDs');
      end = c.endMs; previousId = c.id;
    }
    const assetRef = (id: string | null | undefined, at: string) => { if (id && !ownEntry(p.assets, id)) error('ASSET_REF', at, `Unknown asset ${id}`); };
    const covered = new Set<number>();
    for (const scene of p.scenes) {
      const at = `${path}.production.scenes.${scene.id}`;
      if (!s.captions.some(c => c.id === scene.captionRange.start) || !s.captions.some(c => c.id === scene.captionRange.end)) error('CAPTION_REF', at, 'Scene caption range endpoint does not exist');
      const effectiveType = ownEntry(o.scenes, scene.id)?.type ?? scene.type;
      if (profile?.allowedSceneTypes && !profile.allowedSceneTypes.includes(effectiveType)) error('SCENE_POLICY', at, 'Scene type forbidden by profile');
      assetRef(scene.visual.assetId, at);
      for (const c of s.captions.filter(c => c.id >= scene.captionRange.start && c.id <= scene.captionRange.end)) { if (covered.has(c.id)) warning('SCENE_OVERLAP', at, `Caption ${c.id} assigned repeatedly`); covered.add(c.id); }
    }
    if (s.captions.some(c => !covered.has(c.id))) warning('UNASSIGNED_CAPTION', path, 'Some captions have no scene');
    for (const i of p.inserts) {
      const at = `${path}.production.inserts.${i.id}`;
      assetRef(i.assetId, at);
      let time: number | undefined;
      if (i.anchor.type === 'source_time') time = i.anchor.timeMs;
      else { const anchor = i.anchor; const c = s.captions.find(c => c.id === anchor.captionId); if (!c) error('CAPTION_REF', at, 'Anchor caption does not exist'); else time = anchor.type === 'caption_before' ? c.startMs : c.endMs; }
      if (time !== undefined && (time > s.durationMs || (i.timingMode !== 'overlay' && s.captions.some(c => time! > c.startMs && time! < c.endMs)))) error('ANCHOR_TIME', at, 'Anchor outside source or splits a caption');
      if (profile?.insertPolicy && !profile.insertPolicy.allowedModes.includes(i.timingMode)) error('INSERT_POLICY', at, 'Timing mode forbidden by profile');
      const asset = i.assetId ? ownEntry(p.assets, i.assetId) : undefined;
      if (asset && ((i.type === 'ANIME_CLIP' && asset.type !== 'anime_clip') || (i.type === 'DRAMA_CLIP' && asset.type !== 'drama_clip'))) error('ASSET_TYPE', at, 'Clip and asset type disagree');
      const trim = ownEntry(o.inserts, i.id)?.trim ?? i.trim;
      if (asset?.durationMs !== undefined && (trim?.endMs ?? i.durationMs) > asset.durationMs) error('ASSET_DURATION', at, 'Insert exceeds asset duration');
    }
    for (const [id, override] of Object.entries(o.scenes)) { if (!p.scenes.some(s => s.id === id)) error('SCENE_REF', `${path}.overrides.scenes.${id}`, 'Unknown scene'); assetRef(override.visual?.assetId, `${path}.overrides.scenes.${id}`); }
    for (const id of Object.keys(o.inserts)) if (!p.inserts.some(i => i.id === id)) error('INSERT_REF', `${path}.overrides.inserts.${id}`, 'Unknown insert');
    if (p.project.origin.sourceType === 'derived') {
      const origin = p.project.origin;
      const parent = w.projects.find(b => b.production.project.id === origin.sourceLongProjectId)?.production;
      if (!p.project.contentType.endsWith('_short') || !parent?.project.contentType.endsWith('_long') || parent.project.channelPack !== p.project.channelPack) error('DERIVATION', path, 'Derived Short needs a Long project in the same pack');
      if (w.projects.some(b => b !== bundle && b.production.project.origin.sourceType === 'derived' && b.production.project.origin.sourceLongProjectId === origin.sourceLongProjectId && b.production.project.origin.derivativeIndex === origin.derivativeIndex)) error('DERIVATIVE_INDEX', path, 'Derivative index must be unique per Long project');
    }
  }
  unique(w.contents.flatMap(c => c.productionProjectId ? [c.productionProjectId] : []), 'contents.productionProjectId');
  for (const [index, c] of w.contents.entries()) {
    const path = `contents.${index}`;
    checkProfile(c, path);
    unique(c.derivedShortIds, `${path}.derivedShortIds`); unique(c.relatedContentIds, `${path}.relatedContentIds`);
    const p = w.projects.find(b => b.production.project.id === c.productionProjectId)?.production.project;
    if (c.productionProjectId && !p) error('PROJECT_REF', path, 'Unknown production project');
    if (p && (p.contentType !== c.contentType || p.contentProfile !== c.contentProfile || p.channelPack !== c.channelPack || p.origin.sourceType !== c.relationship.sourceType)) error('CONTENT_PROJECT', path, 'Content and project contracts disagree');
    if (c.relationship.sourceType === 'derived') {
      const parentId = c.relationship.parentLongId;
      const parent = w.contents.find(c => c.id === parentId);
      if (!c.contentType.endsWith('_short') || !parent?.contentType.endsWith('_long') || !parent.derivedShortIds.includes(c.id) || parent.channelPack !== c.channelPack) error('CONTENT_RELATION', path, 'Derived content needs reciprocal Long parent in same pack');
      if (p?.origin.sourceType === 'derived' && parent?.productionProjectId !== p.origin.sourceLongProjectId) error('CONTENT_PROJECT', path, 'Content parent and project source disagree');
    }
    for (const id of c.derivedShortIds) { const child = w.contents.find(c => c.id === id); if (!c.contentType.endsWith('_long') || child?.relationship.sourceType !== 'derived' || child.relationship.parentLongId !== c.id) error('CONTENT_RELATION', path, 'Invalid reciprocal derived child'); }
    for (const id of c.relatedContentIds) if (id === c.id || !w.contents.some(c => c.id === id)) error('CONTENT_REF', path, 'Invalid related content');
  }
  return { valid: !diagnostics.some(d => d.severity === 'error'), diagnostics };
}

/** Contract readiness only: no file existence, decode, rendering or upload claim. */
export function checkFinalRenderReadiness(input: unknown, projectId: string): ValidationResult {
  const result = validateWorkspace(input);
  if (!result.valid) return result;
  const w = WorkspaceSchema.parse(input);
  const bundle = w.projects.find(b => b.production.project.id === projectId);
  const diagnostics = [...result.diagnostics];
  const fail = (code: string, message: string) => diagnostics.push({ severity: 'error', code, path: `projects.${projectId}`, message });
  if (!bundle) fail('PROJECT_REF', 'Unknown project');
  else {
    const { production: p, overrides: o, approval: a } = bundle;
    if (!['approved', 'rendered'].includes(p.project.status) || !a || a.productionRevision !== p.project.revision || a.overridesRevision !== o.revision) fail('APPROVAL_REQUIRED', 'Current production and overrides revisions must be approved');
    const used = new Set<string>();
    for (const s of p.scenes) { const id = ownEntry(o.scenes, s.id)?.visual?.assetId ?? s.visual.assetId; if (id) used.add(id); }
    for (const i of p.inserts) if (i.assetId) used.add(i.assetId);
    for (const id of used) if (ownEntry(p.assets, id)?.status !== 'ready') fail('ASSET_NOT_READY', `Used asset ${id} is not ready`);
    for (const [id, asset] of Object.entries(p.assets)) if (asset.status === 'required') fail('ASSET_REQUIRED', `Required asset ${id} is unresolved`);
  }
  return { valid: !diagnostics.some(d => d.severity === 'error'), diagnostics };
}
