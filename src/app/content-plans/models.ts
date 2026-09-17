import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const text = z.string().min(1);
const isoDateTime = z.iso.datetime({ offset: true });

export const ContentPlanTypeSchema = z.enum([
  'discovery_long',
  'training_long',
  'discovery_short',
  'learning_short',
]);

export const ContentPlanStatusSchema = z.enum([
  'DRAFT',
  'PLANNED',
  'IN_PROGRESS',
  'READY',
  'PUBLISHED',
]);

export const ContentPlanSchema = z.strictObject({
  contentId: id,
  contentType: ContentPlanTypeSchema,
  title: text.max(200),
  status: ContentPlanStatusSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  hookText: z.string().min(1).max(500).optional(),
  sourceClipId: id.optional(),
  sourceFrameId: id.optional(),
  publishedAt: isoDateTime.optional(),
});

export const CreateContentPlanInputSchema = z.strictObject({
  contentId: id,
  contentType: ContentPlanTypeSchema,
  title: text.max(200),
  status: ContentPlanStatusSchema,
  hookText: z.string().min(1).max(500).optional(),
  sourceClipId: id.optional(),
  sourceFrameId: id.optional(),
  publishedAt: isoDateTime.optional(),
});

const optionalNullableText = z.string().min(1).nullable().optional();
export const UpdateContentPlanInputSchema = z.strictObject({
  contentType: ContentPlanTypeSchema.optional(),
  title: text.max(200).optional(),
  status: ContentPlanStatusSchema.optional(),
  hookText: z.string().min(1).max(500).nullable().optional(),
  sourceClipId: optionalNullableText,
  sourceFrameId: optionalNullableText,
  publishedAt: isoDateTime.nullable().optional(),
}).refine(
  patch => Object.values(patch).some(value => value !== undefined),
  { message: 'At least one content plan field must be updated' },
);

export type ContentPlan = z.infer<typeof ContentPlanSchema>;
export type ContentPlanStatus = z.infer<typeof ContentPlanStatusSchema>;
export type CreateContentPlanInput = z.infer<typeof CreateContentPlanInputSchema>;
export type UpdateContentPlanInput = z.infer<typeof UpdateContentPlanInputSchema>;
