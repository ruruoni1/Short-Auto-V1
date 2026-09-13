import { z } from 'zod';

const id = z.string().min(1);
const text = z.string().min(1);
const nullableText = z.string().min(1).nullable();
const nullableFormText = z.preprocess((value) => value === '' ? null : value, nullableText);
const isoDateTime = z.iso.datetime({ offset: true });
const count = z.string().regex(/^(0|[1-9]\d*)$/, 'Count must be a non-negative integer string').nullable();
const score = z.number().finite().min(0).max(100).nullable();
const relativePath = text.refine(
  (value) => !/^(?:[A-Za-z]:|[\\/])/.test(value)
    && !value.split(/[\\/]/).includes('..'),
  'Use a project-relative path without traversal',
);

export const ChannelCategorySchema = z.enum(['anime', 'drama']);
export const SourcePrioritySchema = z.enum(['S', 'A', 'B']);
export const ClipTypeSchema = z.enum([
  'scene',
  'highlight',
  'short',
  'cutout',
  'digest',
  'preview',
  'pv',
  'other',
]);
export const WorkTierSchema = z.enum(['NOW', 'EVERGREEN', 'DISCOVERY']);
export const SourceClipStatusSchema = z.enum([
  'NEW',
  'ANALYZED',
  'REVIEWED',
  'CANDIDATE',
  'SELECTED',
  'DOWNLOADED',
  'REJECTED',
]);
export const RepositoryJobKindSchema = z.enum(['sync', 'download']);
export const RepositoryJobStateSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);

export const SourceChannelSchema = z.strictObject({
  id,
  youtubeChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  channelName: text,
  category: ChannelCategorySchema,
  sourcePriority: SourcePrioritySchema,
  officialVerified: z.boolean(),
  enabled: z.boolean(),
  notes: z.string(),
  uploadsPlaylistId: nullableText,
  lastSyncedAt: isoDateTime.nullable(),
  lastSyncedVideoId: nullableText,
  revision: z.number().int().nonnegative(),
});

export const CreateChannelInputSchema = z.strictObject({
  youtubeChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  channelName: text,
  category: ChannelCategorySchema,
  sourcePriority: SourcePrioritySchema,
  officialVerified: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  notes: z.string().optional().default(''),
  uploadsPlaylistId: nullableFormText.optional().default(null),
});

export const UpdateChannelInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  channelName: text.optional(),
  category: ChannelCategorySchema.optional(),
  sourcePriority: SourcePrioritySchema.optional(),
  officialVerified: z.boolean().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().optional(),
  uploadsPlaylistId: nullableFormText.optional(),
}).refine(
  ({ expectedRevision: _expectedRevision, ...patch }) =>
    Object.values(patch).some((value) => value !== undefined),
  { message: 'At least one channel field must be updated' },
);

export const DisableChannelInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});

/** Metadata supplied by the YouTube connector. Repository-owned fields are excluded. */
export const RemoteClipSchema = z.strictObject({
  youtubeChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: text,
  description: z.string(),
  publishedAt: isoDateTime,
  durationSeconds: z.number().int().nonnegative().nullable(),
  thumbnailUrl: z.url().nullable(),
  viewCount: count,
  likeCount: count,
  commentCount: count,
});

export const RemoteClipListSchema = z.array(RemoteClipSchema);

export const SourceClipSchema = z.strictObject({
  id,
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  channelId: id,
  contentType: ChannelCategorySchema,
  workTitle: nullableText,
  episode: nullableText,
  clipType: ClipTypeSchema,
  title: text,
  description: z.string(),
  dialogueCandidate: nullableText,
  readingKo: nullableText,
  meaningKo: nullableText,
  contextNotes: nullableText,
  publishedAt: isoDateTime,
  durationSeconds: z.number().int().nonnegative().nullable(),
  viewCount: count,
  likeCount: count,
  commentCount: count,
  youtubeUrl: z.url(),
  thumbnailUrl: z.url().nullable(),
  subtitleAvailable: z.boolean().nullable(),
  subtitlePath: nullableText,
  localVideoPath: nullableText,
  localAudioPath: nullableText,
  sourcePriority: SourcePrioritySchema,
  workTier: WorkTierSchema,
  languageValueScore: score,
  sourceAvailabilityScore: score,
  popularityScore: score,
  finalScore: score,
  status: SourceClipStatusSchema,
  reviewedAt: isoDateTime.nullable(),
  reviewNotes: nullableText,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  revision: z.number().int().nonnegative(),
});

export const ListClipsQuerySchema = z.strictObject({
  q: z.string().min(1).optional(),
  channelId: id.optional(),
  contentType: ChannelCategorySchema.optional(),
  clipType: ClipTypeSchema.optional(),
  status: SourceClipStatusSchema.optional(),
  workTier: WorkTierSchema.optional(),
  workTitle: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().optional().default(0),
  limit: z.number().int().positive().max(200).optional().default(50),
});

export const ReviewClipPatchSchema = z.strictObject({
  workTitle: nullableFormText.optional(),
  episode: nullableFormText.optional(),
  clipType: ClipTypeSchema.optional(),
  dialogueCandidate: nullableFormText.optional(),
  readingKo: nullableFormText.optional(),
  meaningKo: nullableFormText.optional(),
  contextNotes: nullableFormText.optional(),
  workTier: WorkTierSchema.optional(),
  languageValueScore: score.optional(),
  sourceAvailabilityScore: score.optional(),
  popularityScore: score.optional(),
  finalScore: score.optional(),
  reviewNotes: nullableFormText.optional(),
});

export const ReviewClipInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['save', 'hold', 'select', 'reject']),
  patch: ReviewClipPatchSchema.optional(),
  humanConfirmed: z.boolean().optional(),
});

export const DownloadOptionsSchema = z.strictObject({
  quality: z.enum(['best', '1080p', '720p']),
  subtitles: z.boolean(),
});

export const CompleteSyncInputSchema = z.strictObject({
  uploadsPlaylistId: nullableFormText,
  lastSyncedVideoId: nullableFormText,
});

export const FinishDownloadInputSchema = z.strictObject({
  localVideoPath: relativePath,
  subtitlePath: relativePath.optional(),
  localAudioPath: relativePath.optional(),
});

export const FailJobInputSchema = z.strictObject({
  code: text,
  message: text,
});

export const RepositoryJobSchema = z.strictObject({
  id,
  kind: RepositoryJobKindSchema,
  state: RepositoryJobStateSchema,
  channelId: id.nullable(),
  clipId: id.nullable(),
  quality: z.enum(['best', '1080p', '720p']).nullable(),
  subtitles: z.boolean().nullable(),
  errorCode: nullableText,
  errorMessage: nullableText,
  createdAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
});

export type ChannelCategory = z.infer<typeof ChannelCategorySchema>;
export type SourcePriority = z.infer<typeof SourcePrioritySchema>;
export type ClipType = z.infer<typeof ClipTypeSchema>;
export type WorkTier = z.infer<typeof WorkTierSchema>;
export type SourceClipStatus = z.infer<typeof SourceClipStatusSchema>;
export type SourceChannel = z.infer<typeof SourceChannelSchema>;
export type SourceClip = z.infer<typeof SourceClipSchema>;
export type RemoteClip = z.infer<typeof RemoteClipSchema>;
export type CreateChannelInput = z.input<typeof CreateChannelInputSchema>;
export type UpdateChannelInput = z.input<typeof UpdateChannelInputSchema>;
export type DisableChannelInput = z.infer<typeof DisableChannelInputSchema>;
export type ListClipsQuery = z.input<typeof ListClipsQuerySchema>;
export type ReviewClipPatch = z.infer<typeof ReviewClipPatchSchema>;
export type ReviewClipInput = z.infer<typeof ReviewClipInputSchema>;
export type DownloadOptions = z.infer<typeof DownloadOptionsSchema>;
export type CompleteSyncInput = z.infer<typeof CompleteSyncInputSchema>;
export type FinishDownloadInput = z.infer<typeof FinishDownloadInputSchema>;
export type FailJobInput = z.infer<typeof FailJobInputSchema>;
export type RepositoryJob = z.infer<typeof RepositoryJobSchema>;
