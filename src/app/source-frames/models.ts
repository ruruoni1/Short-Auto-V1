import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const isoDateTime = z.iso.datetime({ offset: true });
const dimension = z.number().int().positive().max(16_384);
const relativePath = z.string().min(1).refine(
  value => !/^(?:[A-Za-z]:|[\\/])/.test(value) && !value.split(/[\\/]/).includes('..'),
  'Use a project-relative path without traversal',
);

export const SourceFrameFormatSchema = z.enum(['jpeg', 'png']);
export const SourceFrameCandidateTypeSchema = z.enum(['thumbnail', 'reference', 'storyboard']);
export const RightsReviewStatusSchema = z.enum(['unchecked', 'reviewed', 'rejected']);

export const SourceFrameSchema = z.strictObject({
  id,
  sourceClipId: id,
  sourceChannelId: id,
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  timestampMs: z.number().int().safe().nonnegative(),
  localPath: relativePath,
  format: SourceFrameFormatSchema,
  mimeType: z.enum(['image/jpeg', 'image/png']),
  width: dimension,
  height: dimension,
  byteLength: z.number().int().positive().max(50 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  candidateType: SourceFrameCandidateTypeSchema,
  rightsReviewStatus: RightsReviewStatusSchema,
  rightsReviewNotes: z.string().max(2_000),
  workTitle: z.string().min(1).nullable(),
  episode: z.string().min(1).nullable(),
  sourceUrl: z.url(),
  createdAt: isoDateTime,
  revision: z.number().int().nonnegative(),
}).superRefine((frame, context) => {
  const expectedMimeType = frame.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  if (frame.mimeType !== expectedMimeType) {
    context.addIssue({ code: 'custom', path: ['mimeType'], message: 'MIME type must match the frame format' });
  }
});

export const CreateSourceFrameInputSchema = z.strictObject({
  timestampMs: z.number().int().safe().nonnegative(),
  format: SourceFrameFormatSchema.optional().default('jpeg'),
  candidateType: SourceFrameCandidateTypeSchema.optional().default('thumbnail'),
  rightsReviewNotes: z.string().max(2_000).optional().default(''),
});

export const ListSourceFramesQuerySchema = z.strictObject({
  clipId: id.optional(),
});

export const ReviewSourceFrameInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  status: z.enum(['reviewed', 'rejected']),
  notes: z.string().trim().min(1).max(2_000),
});

export type SourceFrameFormat = z.infer<typeof SourceFrameFormatSchema>;
export type SourceFrame = z.infer<typeof SourceFrameSchema>;
export type CreateSourceFrameInput = z.input<typeof CreateSourceFrameInputSchema>;
export type ListSourceFramesQuery = z.infer<typeof ListSourceFramesQuerySchema>;
export type ReviewSourceFrameInput = z.infer<typeof ReviewSourceFrameInputSchema>;
