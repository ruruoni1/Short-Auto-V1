import { z } from 'zod';
import { ProductionSchema, SourceTimelineSchema, OverridesSchema, ResolvedTimelineSchema } from './models.js';
import type { ResolvedTimeline } from './models.js';
import { validateCaptions } from './caption.js';
import type { Diagnostic, ValidationResult } from './validation.js';

export const TimelineInputSchema = z.strictObject({ production: ProductionSchema, source: SourceTimelineSchema, overrides: OverridesSchema });
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type ResolveTimelineResult =
  | { valid: true; timeline: ResolvedTimeline; diagnostics: Diagnostic[] }
  | { valid: false; timeline: null; diagnostics: Diagnostic[] };
type Segment = ResolvedTimeline['segments'][number];
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined;

/** Pure integer-ms calculation. No media access, approval, scene layout or frame conversion. */
export function resolveTimeline(input: unknown): ResolveTimelineResult {
  const parsed = TimelineInputSchema.safeParse(input);
  if (!parsed.success) return { valid: false, timeline: null, diagnostics: parsed.error.issues.map(i => ({ severity: 'error', code: 'TIMELINE_INPUT_SCHEMA', path: i.path.join('.'), message: i.message })) };
  const { production: p, source: s, overrides: o } = parsed.data;
  const diagnostics: Diagnostic[] = validateCaptions(s).diagnostics.map(d => ({ ...d, path: `source.${d.path}` }));
  const error = (code: string, path: string, message: string) => diagnostics.push({ severity: 'error', code, path, message });
  const warning = (code: string, path: string, message: string) => diagnostics.push({ severity: 'warning', code, path, message });
  const failed = () => diagnostics.some(d => d.severity === 'error');
  const failure = (): ResolveTimelineResult => ({ valid: false, timeline: null, diagnostics });
  if (p.project.id !== o.projectId) error('TIMELINE_PROJECT_REF', 'overrides.projectId', 'Overrides belong to another project');
  const assetRef = (id: string | null | undefined, path: string) => {
    if (id && !own(p.assets, id)) error('TIMELINE_ASSET_REF', path, `Unknown asset ${id}`);
  };
  const captionIds = new Set(s.captions.map(c => c.id));
  const sceneIds = new Set<string>();
  const covered = new Set<number>();
  p.scenes.forEach((scene, index) => {
    const path = `production.scenes.${index}`;
    if (sceneIds.has(scene.id)) error('TIMELINE_DUPLICATE_ID', path, `Duplicate scene ${scene.id}`);
    sceneIds.add(scene.id);
    if (!captionIds.has(scene.captionRange.start) || !captionIds.has(scene.captionRange.end)) error('TIMELINE_CAPTION_REF', path, 'Unknown scene caption range endpoint');
    assetRef(scene.visual.assetId, `${path}.visual.assetId`);
    for (const c of s.captions.filter(c => c.id >= scene.captionRange.start && c.id <= scene.captionRange.end)) {
      if (covered.has(c.id)) warning('TIMELINE_SCENE_OVERLAP', path, `Caption ${c.id} belongs to multiple scenes`);
      covered.add(c.id);
    }
  });
  if (s.captions.some(c => !covered.has(c.id))) warning('TIMELINE_UNASSIGNED_CAPTION', 'production.scenes', 'Some captions have no scene; all TTS time is still preserved');
  for (const [id, override] of Object.entries(o.scenes)) {
    const path = `overrides.scenes.${id}`;
    if (!sceneIds.has(id)) error('TIMELINE_SCENE_REF', path, 'Unknown scene');
    assetRef(override.visual?.assetId, `${path}.visual.assetId`);
    if (override.outputTiming) error('TIMELINE_UNSUPPORTED_OUTPUT_TIMING', `${path}.outputTiming`, 'Scene outputTiming requires a scene timing resolver and cannot be applied here');
    if (Object.keys(override).some(k => k !== 'outputTiming')) warning('TIMELINE_DEFERRED_OVERRIDE', path, 'Scene presentation overrides must be applied by the scene/render stage');
  }
  if (Object.keys(o.global).length) warning('TIMELINE_DEFERRED_OVERRIDE', 'overrides.global', 'Global presentation overrides must be applied by the scene/render stage');
  const insertIds = new Set<string>();
  const events = p.inserts.map((insert, index) => {
    const path = `production.inserts.${index}`;
    if (insertIds.has(insert.id)) error('TIMELINE_DUPLICATE_ID', path, `Duplicate insert ${insert.id}`);
    insertIds.add(insert.id);
    assetRef(insert.assetId, `${path}.assetId`);
    const anchor = insert.anchor;
    const caption = anchor.type === 'source_time' ? undefined : s.captions.find(c => c.id === anchor.captionId);
    const time = anchor.type === 'source_time' ? anchor.timeMs : caption ? (anchor.type === 'caption_before' ? caption.startMs : caption.endMs) : 0;
    if (anchor.type !== 'source_time' && !caption) error('TIMELINE_CAPTION_REF', `${path}.anchor`, 'Unknown anchor caption');
    if (time > s.durationMs || (insert.timingMode !== 'overlay' && s.captions.some(c => c.startMs < time && time < c.endMs))) error('TIMELINE_ANCHOR_TIME', `${path}.anchor`, 'Anchor exceeds source duration or stops inside a caption');
    const trim = own(o.inserts, insert.id)?.trim ?? insert.trim;
    const duration = trim ? trim.endMs - trim.startMs : insert.durationMs;
    const asset = insert.assetId ? own(p.assets, insert.assetId) : undefined;
    if (asset && ((insert.type === 'ANIME_CLIP' && asset.type !== 'anime_clip') || (insert.type === 'DRAMA_CLIP' && asset.type !== 'drama_clip'))) error('TIMELINE_ASSET_TYPE', path, 'Clip and asset type disagree');
    if (asset?.durationMs !== undefined && (trim?.endMs ?? duration) > asset.durationMs) error('TIMELINE_ASSET_DURATION', path, 'Effective trim/duration exceeds declared asset duration');
    return { insert, index, time, duration };
  }).sort((a, b) => a.time - b.time || a.index - b.index);
  for (const id of Object.keys(o.inserts)) if (!insertIds.has(id)) error('TIMELINE_INSERT_REF', `overrides.inserts.${id}`, 'Unknown insert');
  if (p.ending.enabled && p.ending.durationMs === 0) error('TIMELINE_ENDING_DURATION', 'production.ending.durationMs', 'Enabled ending needs positive duration');
  if (failed()) return failure();

  const add = (a: number, b: number, path: string) => {
    const value = a + b;
    if (!Number.isSafeInteger(value)) error('TIMELINE_DURATION_OVERFLOW', path, 'Timeline arithmetic exceeds safe integer milliseconds');
    return value;
  };
  const base: Segment[] = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  const appendTts = (end: number) => {
    if (end <= sourceCursor) return;
    const outputEndMs = add(outputCursor, end - sourceCursor, 'source.durationMs');
    base.push({ type: 'tts', sourceStartMs: sourceCursor, sourceEndMs: end, outputStartMs: outputCursor, outputEndMs });
    sourceCursor = end; outputCursor = outputEndMs;
  };
  // Only stopping events partition the TTS. Silence is ordinary source time.
  const stops = events.filter(e => e.insert.timingMode !== 'overlay');
  for (const e of stops) {
    appendTts(e.time);
    const outputEndMs = add(outputCursor, e.duration, `production.inserts.${e.index}`);
    base.push({ type: e.insert.timingMode as 'insert' | 'pause', insertId: e.insert.id, outputStartMs: outputCursor, outputEndMs });
    outputCursor = outputEndMs;
  }
  appendTts(s.durationMs);
  const narrationEnd = outputCursor;
  const overlays: Segment[] = [];
  let stopIndex = 0;
  let delay = 0;
  for (const e of events.filter(e => e.insert.timingMode === 'overlay')) {
    while (stopIndex < stops.length && stops[stopIndex]!.time <= e.time) {
      delay = add(delay, stops[stopIndex]!.duration, 'segments'); stopIndex++;
    }
    const outputStartMs = add(e.time, delay, `production.inserts.${e.index}`);
    const outputEndMs = add(outputStartMs, e.duration, `production.inserts.${e.index}`);
    if (outputEndMs > narrationEnd) error('TIMELINE_OVERLAY_BOUNDS', `production.inserts.${e.index}`, 'Overlay must fit within output before the ending; no clipping or extension is performed');
    overlays.push({ type: 'overlay', insertId: e.insert.id, outputStartMs, outputEndMs });
  }
  if (p.ending.enabled) {
    outputCursor = add(outputCursor, p.ending.durationMs, 'production.ending.durationMs');
    base.push({ type: 'ending', outputStartMs: narrationEnd, outputEndMs: outputCursor });
  }
  if (failed()) return failure();
  // Stable tie: base before overlay; overlay order follows production array.
  const segments = [...base, ...overlays].sort((a, b) => a.outputStartMs - b.outputStartMs);
  return { valid: true, timeline: { projectId: p.project.id, productionRevision: p.project.revision, overridesRevision: o.revision, durationMs: outputCursor, segments }, diagnostics };
}

/** Deep validation against the exact inputs/revisions used to resolve a timeline. */
export function validateResolvedTimeline(input: unknown, timeline: unknown): ValidationResult {
  const expected = resolveTimeline(input);
  if (!expected.valid) return { valid: false, diagnostics: expected.diagnostics };
  const parsed = ResolvedTimelineSchema.safeParse(timeline);
  if (!parsed.success) return { valid: false, diagnostics: [...expected.diagnostics, ...parsed.error.issues.map(i => ({ severity: 'error' as const, code: 'TIMELINE_OUTPUT_SCHEMA', path: i.path.join('.'), message: i.message }))] };
  const actual = parsed.data;
  const diagnostics = [...expected.diagnostics];
  const error = (code: string, path: string, message: string) => diagnostics.push({ severity: 'error', code, path, message });
  const target = expected.timeline;
  if (actual.projectId !== target.projectId) error('TIMELINE_PROJECT_REF', 'projectId', 'Timeline project mismatch');
  if (actual.productionRevision !== target.productionRevision || actual.overridesRevision !== target.overridesRevision) error('TIMELINE_REVISION', 'productionRevision', 'Timeline revisions do not match inputs');
  if (actual.durationMs !== target.durationMs) error('TIMELINE_DURATION', 'durationMs', 'Total duration disagrees with source, effective inserts and ending');
  const operations = new Map(target.segments.flatMap(s => 'insertId' in s ? [[s.insertId, s] as const] : []));
  const seen = new Set<string>();
  const tts = target.segments.filter(s => s.type === 'tts');
  let sourceCursor = 0;
  let outputCursor = 0;
  let lastStart = -1;
  let endings = 0;
  for (const [index, segment] of actual.segments.entries()) {
    const path = `segments.${index}`;
    if (segment.outputStartMs < lastStart) error('TIMELINE_SEGMENT_ORDER', path, 'Segments must be ordered by output start');
    lastStart = segment.outputStartMs;
    if (segment.type !== 'overlay') {
      if (segment.outputStartMs !== outputCursor) error('TIMELINE_OUTPUT_CONTINUITY', path, 'Base output has a gap or overlap');
      outputCursor = segment.outputEndMs;
    }
    if (segment.type === 'tts') {
      if (segment.sourceStartMs !== sourceCursor) error('TIMELINE_SOURCE_COVERAGE', path, 'TTS source has a gap, duplicate or reordering');
      sourceCursor = segment.sourceEndMs;
      const window = tts.find(t => t.sourceStartMs <= segment.sourceStartMs && t.sourceEndMs >= segment.sourceEndMs);
      if (!window || segment.outputStartMs - segment.sourceStartMs !== window.outputStartMs - window.sourceStartMs) error('TIMELINE_TTS_MAPPING', path, 'TTS crosses a stop or has the wrong output offset');
    } else if ('insertId' in segment) {
      const op = operations.get(segment.insertId);
      if (!op) error('TIMELINE_INSERT_REF', path, 'Unknown insert in output');
      if (seen.has(segment.insertId)) error('TIMELINE_INSERT_DUPLICATE', path, 'Insert appears more than once');
      seen.add(segment.insertId);
      if (op && (segment.type !== op.type || segment.outputStartMs !== op.outputStartMs || segment.outputEndMs !== op.outputEndMs)) error('TIMELINE_INSERT_TIMING', path, 'Insert mode, anchor or effective duration disagrees with inputs');
    } else {
      endings++;
      const ending = target.segments.find(s => s.type === 'ending');
      if (!ending || segment.outputStartMs !== ending.outputStartMs || segment.outputEndMs !== ending.outputEndMs) error('TIMELINE_ENDING', path, 'Ending is disabled or misplaced');
    }
  }
  if (outputCursor !== actual.durationMs) error('TIMELINE_OUTPUT_CONTINUITY', 'segments', 'Base output does not cover total duration');
  const sourceEnd = tts.at(-1)!.sourceEndMs;
  if (sourceCursor !== sourceEnd) error('TIMELINE_SOURCE_COVERAGE', 'segments', 'TTS does not cover the entire source');
  for (const id of operations.keys()) if (!seen.has(id)) error('TIMELINE_INSERT_MISSING', 'segments', `Missing insert ${id}`);
  if (endings !== target.segments.filter(s => s.type === 'ending').length) error('TIMELINE_ENDING', 'segments', 'Ending count disagrees with inputs');
  return { valid: !diagnostics.some(d => d.severity === 'error'), diagnostics };
}
