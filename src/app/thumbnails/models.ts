import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const isoDateTime = z.iso.datetime({ offset: true });
const finite = z.number().finite();
const dimension = z.number().int().positive().max(16_384);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const relativePath = z.string().min(1).refine(
  value => !/^(?:[A-Za-z]:|[\\/])/.test(value) && !value.split(/[\\/]/).includes('..'),
  'Use a project-relative path without traversal',
);

export const ThumbnailSourceTypeSchema = z.enum([
  'AI_GENERATED',
  'OFFICIAL_CLIP_FRAME',
  'USER_IMAGE',
  'RECREATED_IMAGE',
]);

export const CanvasSchema = z.strictObject({
  width: dimension,
  height: dimension,
});

export const SafeAreaSchema = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: dimension,
  height: dimension,
});

export const ShadowSchema = z.strictObject({
  enabled: z.boolean(),
  x: finite.min(-100).max(100),
  y: finite.min(-100).max(100),
  blur: finite.min(0).max(100),
  opacity: finite.min(0).max(1),
});

export const TextLayerSchema = z.strictObject({
  id,
  type: z.literal('text'),
  text: z.string().max(160),
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
  rotation: finite.min(-360).max(360),
  fontFamily: z.string().min(1).max(120),
  fontWeight: z.number().int().min(100).max(900).multipleOf(100),
  fontSize: finite.min(1).max(1_000),
  color,
  align: z.enum(['left', 'center', 'right']),
  letterSpacing: finite.min(-20).max(100),
  lineHeight: finite.min(0.5).max(5),
  strokeColor: color,
  strokeWidth: finite.min(0).max(50),
  shadow: ShadowSchema,
  locked: z.boolean(),
  visible: z.boolean(),
});

export const BaseImageTransformSchema = z.strictObject({
  x: finite,
  y: finite,
  scale: finite.positive().max(16_384),
  rotation: finite.min(-360).max(360),
  blur: finite.min(0).max(100),
  dim: finite.min(0).max(1),
  brightness: finite.min(0).max(4),
  contrast: finite.min(0).max(4),
});

export const SourceFrameReferenceSchema = z.strictObject({
  sourceClipId: id,
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  sourceChannelId: id,
  frameTimestampMs: z.number().int().nonnegative(),
  workTitle: z.string().min(1),
  episode: z.string().min(1).nullable(),
  sourceUrl: z.url(),
  rightsReviewStatus: z.enum(['unchecked', 'reviewed', 'rejected']),
}).superRefine((source, context) => {
  const url = new URL(source.sourceUrl);
  const host = url.hostname.toLowerCase();
  const videoId = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host) || videoId !== source.youtubeVideoId) {
    context.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Source URL must identify the referenced YouTube video' });
  }
});

export const BaseImageSchema = z.strictObject({
  sourceType: ThumbnailSourceTypeSchema,
  fileName: id,
  path: relativePath,
  mimeType: z.enum(['image/png', 'image/jpeg']),
  width: dimension,
  height: dimension,
  byteLength: z.number().int().positive().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  transform: BaseImageTransformSchema,
  sourceFrame: SourceFrameReferenceSchema.nullable(),
  createdAt: isoDateTime,
}).superRefine((image, context) => {
  if ((image.sourceType === 'OFFICIAL_CLIP_FRAME') !== (image.sourceFrame !== null)) {
    context.addIssue({ code: 'custom', path: ['sourceFrame'], message: 'Official clip frames require complete source and rights metadata' });
  }
});

export const ThumbnailExportSchema = z.strictObject({
  fileName: id,
  path: relativePath,
  format: z.enum(['png', 'jpeg']),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  width: dimension,
  height: dimension,
  byteLength: z.number().int().positive().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  productionRevision: z.number().int().nonnegative(),
  createdAt: isoDateTime,
});

export const ThumbnailProjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  channelProfile: id,
  templateId: id,
  name: z.string().min(1).max(80),
  canvas: CanvasSchema,
  safeArea: SafeAreaSchema,
  safeAreaVisible: z.boolean(),
  baseImage: BaseImageSchema.nullable(),
  layers: z.array(TextLayerSchema).max(100),
  exports: z.array(ThumbnailExportSchema).max(100),
  variantOfProjectId: id.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  revision: z.number().int().nonnegative(),
}).superRefine((project, context) => {
  if (project.safeArea.x + project.safeArea.width > project.canvas.width
    || project.safeArea.y + project.safeArea.height > project.canvas.height) {
    context.addIssue({ code: 'custom', path: ['safeArea'], message: 'Safe area must fit inside the canvas' });
  }
  const layerIds = new Set<string>();
  project.layers.forEach((layer, index) => {
    if (layerIds.has(layer.id)) context.addIssue({ code: 'custom', path: ['layers', index, 'id'], message: 'Layer IDs must be unique' });
    layerIds.add(layer.id);
    if (layer.x + layer.width <= 0 || layer.y + layer.height <= 0
      || layer.x >= project.canvas.width || layer.y >= project.canvas.height) {
      context.addIssue({ code: 'custom', path: ['layers', index], message: 'Layer must intersect the canvas' });
    }
  });
});

export const ThumbnailTemplateSchema = z.strictObject({
  id,
  name: z.string().min(1),
  description: z.string().min(1),
  contentType: z.enum(['discovery_long', 'training_long', 'discovery_short', 'learning_short']),
  canvas: CanvasSchema,
  safeArea: SafeAreaSchema,
  defaultLayers: z.array(TextLayerSchema),
});

export const FontRegistryEntrySchema = z.strictObject({
  id,
  family: z.string().min(1),
  version: z.string().min(1),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  languages: z.array(z.enum(['ko', 'ja', 'latin'])).min(1),
  licenseId: z.string().min(1),
  sourceUrl: z.url(),
  licenseTextPath: relativePath,
  licenseUrl: z.string().startsWith('/'),
  licenseSourceUrl: z.url().optional(),
  licenseSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  bundled: z.boolean(),
  weights: z.array(z.number().int().min(100).max(900).multipleOf(100)).min(1),
  files: z.array(z.strictObject({
    weight: z.number().int().min(100).max(900).multipleOf(100),
    fileName: z.string().min(1),
    url: z.string().startsWith('/'),
    sourceUrl: z.url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    format: z.literal('opentype'),
  })).min(1),
}).superRefine((font, context) => {
  const weights = new Set<number>();
  font.files.forEach((file, index) => {
    if (!font.weights.includes(file.weight)) context.addIssue({ code: 'custom', path: ['files', index, 'weight'], message: 'Font file weight must be registered' });
    if (weights.has(file.weight)) context.addIssue({ code: 'custom', path: ['files', index, 'weight'], message: 'Font file weights must be unique' });
    weights.add(file.weight);
  });
  font.weights.forEach((weight, index) => {
    if (!weights.has(weight)) context.addIssue({ code: 'custom', path: ['weights', index], message: 'Every registered weight needs a bundled file' });
  });
});

export const CreateThumbnailProjectInputSchema = z.strictObject({
  name: z.string().min(1).max(80),
  templateId: id,
  channelProfile: id.optional().default('nihon_zupzup'),
  variantOfProjectId: id.nullable().optional().default(null),
});

export const UpdateThumbnailProjectInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().min(1).max(80).optional(),
  layers: z.array(TextLayerSchema).max(100).optional(),
  safeAreaVisible: z.boolean().optional(),
  baseImageTransform: BaseImageTransformSchema.optional(),
}).refine(
  ({ expectedRevision: _expectedRevision, ...patch }) => Object.values(patch).some(value => value !== undefined),
  { message: 'At least one project field must be updated' },
);

export const RevisionInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});

export const UploadBaseImageInputSchema = RevisionInputSchema.extend({
  sourceType: ThumbnailSourceTypeSchema,
  bytes: z.instanceof(Uint8Array),
  sourceFrame: SourceFrameReferenceSchema.optional(),
});

export const StoreThumbnailExportInputSchema = RevisionInputSchema.extend({
  format: z.enum(['png', 'jpeg']),
  bytes: z.instanceof(Uint8Array),
});

export type ThumbnailSourceType = z.infer<typeof ThumbnailSourceTypeSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type BaseImageTransform = z.infer<typeof BaseImageTransformSchema>;
export type SourceFrameReference = z.infer<typeof SourceFrameReferenceSchema>;
export type ThumbnailProject = z.infer<typeof ThumbnailProjectSchema>;
export type ThumbnailTemplate = z.infer<typeof ThumbnailTemplateSchema>;
export type FontRegistryEntry = z.infer<typeof FontRegistryEntrySchema>;
export type CreateThumbnailProjectInput = z.input<typeof CreateThumbnailProjectInputSchema>;
export type UpdateThumbnailProjectInput = z.input<typeof UpdateThumbnailProjectInputSchema>;
export type UploadBaseImageInput = z.input<typeof UploadBaseImageInputSchema>;
export type StoreThumbnailExportInput = z.input<typeof StoreThumbnailExportInputSchema>;
