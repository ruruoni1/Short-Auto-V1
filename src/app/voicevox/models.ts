import { z } from 'zod';

export const DEFAULT_VOICEVOX_ENDPOINT = 'http://127.0.0.1:50021';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const finite = z.number().finite();

export const VoicevoxStyleSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1).max(200),
});

export const VoicevoxSpeakerSchema = z.object({
  speaker_uuid: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  styles: z.array(VoicevoxStyleSchema).min(1),
});

export const VoiceParametersSchema = z.strictObject({
  speedScale: finite.min(0.5).max(2).optional(),
  pitchScale: finite.min(-0.15).max(0.15).optional(),
  intonationScale: finite.min(0).max(2).optional(),
  volumeScale: finite.min(0).max(2).optional(),
  prePhonemeLength: finite.min(0).max(1.5).optional(),
  postPhonemeLength: finite.min(0).max(1.5).optional(),
});

export const VoiceProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileName: z.string().min(1).max(80),
  engine: z.literal('voicevox'),
  endpoint: z.string().url(),
  speakerUuid: z.string().min(1).max(200),
  speakerName: z.string().min(1).max(200),
  styleId: z.number().int().nonnegative(),
  styleName: z.string().min(1).max(200),
  parameters: VoiceParametersSchema,
  updatedAt: z.iso.datetime({ offset: true }),
});

export const SaveVoiceProfileInputSchema = z.strictObject({
  profileName: z.string().min(1).max(80),
  speakerUuid: z.string().min(1).max(200),
  styleId: z.number().int().nonnegative(),
  parameters: VoiceParametersSchema.optional().default({}),
});

export const AudioQueryInputSchema = z.strictObject({
  text: z.string().min(1).max(5_000),
  styleId: z.number().int().nonnegative(),
  parameters: VoiceParametersSchema.optional().default({}),
});

export const VoicevoxAudioQuerySchema = z.object({
  accent_phrases: z.array(z.unknown()),
  speedScale: finite.min(0.5).max(2),
  pitchScale: finite.min(-0.15).max(0.15),
  intonationScale: finite.min(0).max(2),
  volumeScale: finite.min(0).max(2),
  prePhonemeLength: finite.min(0).max(1.5),
  postPhonemeLength: finite.min(0).max(1.5),
  outputSamplingRate: z.number().int().min(8_000).max(192_000),
  outputStereo: z.boolean(),
  kana: z.string().nullable().optional(),
}).passthrough();

export const SentenceSchema = z.strictObject({
  id,
  text: z.string().min(1).max(5_000),
  parameters: VoiceParametersSchema.optional().default({}),
});

export const GenerateSentencesInputSchema = z.strictObject({
  contentId: id,
  sentences: z.array(SentenceSchema).min(1).max(500),
}).superRefine((input, context) => {
  const seen = new Set<string>();
  input.sentences.forEach((sentence, index) => {
    if (seen.has(sentence.id)) context.addIssue({ code: 'custom', path: ['sentences', index, 'id'], message: 'Sentence IDs must be unique' });
    seen.add(sentence.id);
  });
});

export type VoicevoxSpeaker = z.infer<typeof VoicevoxSpeakerSchema>;
export type VoiceParameters = z.infer<typeof VoiceParametersSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type GenerateSentencesInput = z.infer<typeof GenerateSentencesInputSchema>;

export function parseVoicevoxEndpoint(value = DEFAULT_VOICEVOX_ENDPOINT): URL {
  let endpoint: URL;
  try { endpoint = new URL(value); }
  catch { throw new VoicevoxError('ENDPOINT_INVALID', 'VOICEVOX endpoint 주소가 올바르지 않습니다.', 'configuration', 400, false); }
  const allowed = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' || endpoint.hostname === '[::1]';
  if (endpoint.protocol !== 'http:' || !allowed || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || (endpoint.pathname !== '/' && endpoint.pathname !== '')) {
    throw new VoicevoxError('ENDPOINT_NOT_LOCAL', 'VOICEVOX endpoint는 로컬 HTTP 주소만 사용할 수 있습니다.', 'configuration', 400, false);
  }
  endpoint.pathname = '/';
  return endpoint;
}

export type VoicevoxErrorKind = 'configuration' | 'unavailable' | 'http' | 'invalid_response' | 'storage' | 'selection';

export class VoicevoxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: VoicevoxErrorKind,
    readonly status: number,
    readonly retriable: boolean,
    readonly engineStatus?: number,
  ) {
    super(message);
    this.name = 'VoicevoxError';
  }

  toJSON() {
    return { code: this.code, message: this.message, kind: this.kind, retriable: this.retriable,
      ...(this.engineStatus === undefined ? {} : { engineStatus: this.engineStatus }) };
  }
}
