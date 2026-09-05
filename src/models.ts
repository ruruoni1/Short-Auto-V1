import { z } from 'zod';

export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const text = z.string().min(1);
const ms = z.number().int().nonnegative();
const positiveMs = z.number().int().positive();
const relativePath = text.refine(p => !/^(?:[A-Za-z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..'), 'Use a workspace-relative path without traversal');
export const ContentTypeSchema = z.enum(['discovery_long', 'training_long', 'discovery_short', 'learning_short']);
export const SceneTypeSchema = z.enum(['HOOK', 'KEYWORD', 'QUESTION', 'COMPARE', 'EXPLAIN', 'QUOTE_ANALYSIS', 'RELATION', 'CONCEPT', 'RECAP']);
export const CaptionModeSchema = z.enum(['normal', 'subtle', 'hidden']);
export const MotionSchema = z.strictObject({ preset: z.enum(['FADE_UP', 'SCALE_IN', 'SLIDE_IN', 'STAGGER', 'SLOW_ZOOM', 'PAN', 'FREEZE_FOCUS', 'CUT']), intensity: z.enum(['subtle', 'normal', 'strong']), durationMs: positiveMs.optional() });
export const TransitionSchema = z.enum(['CUT', 'FADE', 'PUSH', 'MATCH']);
export const ThemeSchema = z.strictObject({ id: IdSchema, fontPrimaryKR: text, fontPrimaryJP: text, fontCaption: text, fontNumber: text, colors: z.record(IdSchema, text), defaultMotion: MotionSchema.optional(), defaultTransition: TransitionSchema });
export const CaptionSchema = z.strictObject({ id: z.number().int().positive(), startMs: ms, endMs: positiveMs, text }).refine(c => c.endMs > c.startMs, { message: 'Caption end must follow start', path: ['endMs'] });
export const SourceTimelineSchema = z.strictObject({ durationMs: positiveMs, captions: z.array(CaptionSchema) });
export const AnchorSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('caption_before'), captionId: z.number().int().positive() }),
  z.strictObject({ type: z.literal('caption_after'), captionId: z.number().int().positive() }),
  z.strictObject({ type: z.literal('source_time'), timeMs: ms })
]);
export const AssetSchema = z.strictObject({
  type: z.enum(['anime_clip', 'drama_clip', 'image', 'illustration', 'video', 'screenshot', 'graphic', 'audio']),
  status: z.enum(['ready', 'required', 'missing', 'rejected']),
  role: z.enum(['primary', 'background', 'reference', 'overlay', 'decorative']).optional(),
  src: relativePath.optional(), durationMs: positiveMs.optional(),
  metadata: z.strictObject({ title: text.optional(), episode: text.optional(), expression: text.optional(), sourceUrl: z.url().optional(), sourceTimecode: text.optional(), publicId: text.optional() }).optional(),
  generation: z.strictObject({ description: text, aspectRatio: text }).optional()
}).refine(a => a.status !== 'ready' || a.src !== undefined, { message: 'Ready asset needs src', path: ['src'] });
export const AssetRegistrySchema = z.record(IdSchema, AssetSchema);
const visual = z.strictObject({ strategy: z.enum(['none', 'asset', 'generated_graphic', 'text_only', 'auto']), assetId: IdSchema.nullable() }).refine(v => v.strategy !== 'asset' || v.assetId !== null, 'Asset visual needs assetId');
export const SceneSchema = z.strictObject({
  id: IdSchema, type: SceneTypeSchema, locked: z.boolean(), confidence: z.number().min(0).max(1),
  captionRange: z.strictObject({ start: z.number().int().positive(), end: z.number().int().positive() }).refine(r => r.end >= r.start, 'Caption range is reversed'),
  captionMode: CaptionModeSchema,
  content: z.strictObject({ mainText: text.nullable(), subText: text.nullable(), jpText: text.nullable(), sourceText: text.optional(), emphasis: z.array(text) }),
  visual, motion: MotionSchema.nullable(), transition: TransitionSchema.optional()
});
export const InsertSchema = z.strictObject({
  id: IdSchema, type: z.enum(['ANIME_CLIP', 'DRAMA_CLIP', 'MEDIA', 'PAUSE']),
  timingMode: z.enum(['overlay', 'insert', 'pause']), anchor: AnchorSchema,
  assetId: IdSchema.optional(), durationMs: positiveMs,
  trim: z.strictObject({ startMs: ms, endMs: positiveMs }).refine(t => t.endMs > t.startMs, 'Trim end must follow start').optional()
}).superRefine((i, ctx) => {
  if ((i.type === 'PAUSE') !== (i.timingMode === 'pause')) ctx.addIssue({ code: 'custom', message: 'PAUSE requires pause mode and vice versa' });
  if (i.type !== 'PAUSE' && !i.assetId) ctx.addIssue({ code: 'custom', path: ['assetId'], message: 'Media insert needs assetId' });
  if (i.trim && i.trim.endMs - i.trim.startMs !== i.durationMs) ctx.addIssue({ code: 'custom', path: ['trim'], message: 'Trim length must equal durationMs' });
});
const independent = z.strictObject({ sourceType: z.literal('independent') });
export const ProjectOriginSchema = z.discriminatedUnion('sourceType', [independent, z.strictObject({ sourceType: z.literal('derived'), sourceLongProjectId: IdSchema, derivativeIndex: z.number().int().positive(), derivativeReason: text })]);
export const ProductionSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  project: z.strictObject({ id: IdSchema, title: text, series: text.optional(), contentType: ContentTypeSchema, language: text, channelPack: IdSchema, contentProfile: IdSchema, status: z.enum(['draft', 'auto_generated', 'reviewing', 'approved', 'rendered']), revision: z.number().int().nonnegative(), origin: ProjectOriginSchema }),
  audio: z.strictObject({ tts: relativePath, volume: z.number().min(0).max(1) }),
  captions: z.strictObject({ source: relativePath, parsed: relativePath, show: z.boolean() }),
  settings: z.strictObject({ fps: z.number().positive().max(240), width: z.number().int().positive(), height: z.number().int().positive(), theme: IdSchema, captionStyle: IdSchema, transitionStyle: IdSchema }),
  assets: AssetRegistrySchema, scenes: z.array(SceneSchema), inserts: z.array(InsertSchema),
  ending: z.strictObject({ enabled: z.boolean(), durationMs: ms, type: IdSchema, message: z.string() })
});
const transform = z.strictObject({ offsetX: z.number().optional(), offsetY: z.number().optional(), scale: z.number().positive().optional(), fontSize: z.number().positive().optional(), width: z.number().positive().optional() });
export const OverridesSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), projectId: IdSchema, revision: z.number().int().nonnegative(),
  global: z.strictObject({ captionOffsetY: z.number().optional() }),
  scenes: z.record(IdSchema, z.strictObject({ type: SceneTypeSchema.optional(), captionMode: CaptionModeSchema.optional(), caption: transform.extend({ lines: z.array(text).optional() }).optional(), mainText: transform.optional(), visual: transform.extend({ assetId: IdSchema.optional() }).optional(), motion: MotionSchema.optional(), outputTiming: z.strictObject({ startMs: ms, endMs: positiveMs }).refine(t => t.endMs > t.startMs, 'Output end must follow start').optional() })),
  inserts: z.record(IdSchema, z.strictObject({ trim: z.strictObject({ startMs: ms, endMs: positiveMs }).refine(t => t.endMs > t.startMs, 'Trim end must follow start') }))
});
export const ApprovalSchema = z.strictObject({ projectId: IdSchema, productionRevision: ms, overridesRevision: ms, approvedAt: z.iso.datetime({ offset: true }), approvedBy: text });
export const ResolvedTimelineSchema = z.strictObject({
  projectId: IdSchema, productionRevision: ms, overridesRevision: ms, durationMs: positiveMs,
  segments: z.array(z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('tts'), sourceStartMs: ms, sourceEndMs: positiveMs, outputStartMs: ms, outputEndMs: positiveMs }),
    z.strictObject({ type: z.enum(['insert', 'pause', 'overlay']), insertId: IdSchema, outputStartMs: ms, outputEndMs: positiveMs }),
    z.strictObject({ type: z.literal('ending'), outputStartMs: ms, outputEndMs: positiveMs })
  ]))
}).superRefine((t, ctx) => t.segments.forEach((s, index) => {
  if (s.outputEndMs <= s.outputStartMs || s.outputEndMs > t.durationMs) ctx.addIssue({ code: 'custom', path: ['segments', index], message: 'Invalid output interval' });
  if (s.type === 'tts' && (s.sourceEndMs <= s.sourceStartMs || s.sourceEndMs - s.sourceStartMs !== s.outputEndMs - s.outputStartMs)) ctx.addIssue({ code: 'custom', path: ['segments', index], message: 'TTS must preserve source duration' });
}));
export const ProfileSchema = z.strictObject({
  id: IdSchema, contentType: ContentTypeSchema, allowedSceneTypes: z.array(SceneTypeSchema).optional(), preferredSceneSequence: z.array(SceneTypeSchema).optional(),
  captionPolicy: z.strictObject({ defaultMode: CaptionModeSchema, maxLines: z.number().int().positive() }).optional(),
  typographyPreset: IdSchema.optional(), motionPreset: MotionSchema.optional(),
  visualPolicy: z.strictObject({ preferredStrategies: z.array(z.enum(['none', 'asset', 'generated_graphic', 'text_only', 'auto'])) }).optional(),
  insertPolicy: z.strictObject({ allowedModes: z.array(z.enum(['overlay', 'insert', 'pause'])) }).optional(),
  durationTarget: z.strictObject({ minMs: positiveMs, maxMs: positiveMs }).refine(d => d.maxMs >= d.minMs, 'Invalid duration target').optional(),
  hookPolicy: z.strictObject({ required: z.boolean() }).optional(), endingPolicy: z.strictObject({ type: IdSchema, durationMs: ms }).optional(),
  derivativePolicy: z.strictObject({ targetProfileIds: z.array(IdSchema), candidateCount: z.number().int().positive() }).optional()
});
export const ChannelPackSchema = z.strictObject({ id: IdSchema, version: text, profiles: z.array(ProfileSchema), themes: z.array(ThemeSchema) });
export const ContentRecordSchema = z.strictObject({
  id: IdSchema, title: text, contentType: ContentTypeSchema, contentProfile: IdSchema, channelPack: IdSchema, productionProjectId: IdSchema.optional(),
  status: z.enum(['idea', 'planned', 'script_ready', 'media_ready', 'auto_generated', 'reviewing', 'approved', 'rendered', 'upload_ready', 'uploaded', 'published', 'archived']),
  relationship: z.discriminatedUnion('sourceType', [independent, z.strictObject({ sourceType: z.literal('derived'), parentLongId: IdSchema })]),
  derivedShortIds: z.array(IdSchema), relatedContentIds: z.array(IdSchema), productionDate: z.iso.date().optional(), publishAt: z.iso.datetime({ offset: true }).optional(),
  series: text.optional(), contentAxis: text.optional(), priority: z.number().int().optional()
});
export const PublishingMetadataSchema = z.strictObject({ contentId: IdSchema, projectId: IdSchema, videoFile: relativePath, title: text, description: z.string(), tags: z.array(text), hashtags: z.array(text), thumbnail: relativePath.optional(), playlistIds: z.array(text), visibility: z.enum(['public', 'unlisted', 'private']), scheduledPublishAt: z.iso.datetime({ offset: true }).optional() });
export const PublishingResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('uploaded'), contentId: IdSchema, projectId: IdSchema, videoId: text, uploadedAt: z.iso.datetime({ offset: true }) }),
  z.strictObject({ status: z.literal('failed'), contentId: IdSchema, projectId: IdSchema, error: z.strictObject({ code: text, message: text, retryable: z.boolean() }) })
]);
export const AnalyticsSnapshotSchema = z.strictObject({ contentId: IdSchema, provider: text, videoId: text, collectedAt: z.iso.datetime({ offset: true }), metrics: z.strictObject({ views: ms.optional(), likes: ms.optional(), comments: ms.optional(), averageViewDurationMs: z.number().nonnegative().optional(), averageViewPercentage: z.number().nonnegative().optional(), subscribersGained: ms.optional(), subscribersLost: ms.optional() }), extensions: z.record(text, z.union([z.number(), z.string(), z.boolean(), z.null()])) });

export type Production = z.infer<typeof ProductionSchema>;
export type Caption = z.infer<typeof CaptionSchema>;
export type SourceTimeline = z.infer<typeof SourceTimelineSchema>;
export type ResolvedTimeline = z.infer<typeof ResolvedTimelineSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type Insert = z.infer<typeof InsertSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type AssetRegistry = z.infer<typeof AssetRegistrySchema>;
export type Motion = z.infer<typeof MotionSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Overrides = z.infer<typeof OverridesSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type ContentProfile = z.infer<typeof ProfileSchema>;
export type ChannelPack = z.infer<typeof ChannelPackSchema>;
export type ContentRecord = z.infer<typeof ContentRecordSchema>;
export type PublishingMetadata = z.infer<typeof PublishingMetadataSchema>;
export type PublishingResult = z.infer<typeof PublishingResultSchema>;
export type AnalyticsSnapshot = z.infer<typeof AnalyticsSnapshotSchema>;
export interface Publisher { publish(metadata: PublishingMetadata): Promise<PublishingResult>; }
export interface AnalyticsProvider { collect(contentId: string, videoId: string): Promise<AnalyticsSnapshot>; }
