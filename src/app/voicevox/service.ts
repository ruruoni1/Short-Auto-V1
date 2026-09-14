import { createHash } from 'node:crypto';
import {
  GenerateSentencesInputSchema,
  SaveVoiceProfileInputSchema,
  VoicevoxError,
  type GenerateSentencesInput,
  type VoiceParameters,
  type VoiceProfile,
  type VoicevoxSpeaker,
} from './models.js';
import { VoicevoxClient } from './client.js';
import { VoicevoxRepository } from './repository.js';

export class VoicevoxService {
  constructor(readonly client: VoicevoxClient, readonly repository: VoicevoxRepository) {}

  health() { return this.client.health(); }

  async listSpeakers() {
    const speakers = await this.client.speakers();
    return {
      speakers,
      voices: speakers.flatMap(speaker => speaker.styles.map(style => ({
        speakerUuid: speaker.speaker_uuid, speakerName: speaker.name, styleId: style.id, styleName: style.name,
      }))),
    };
  }

  loadProfile() { return this.repository.loadProfile(); }

  async saveProfile(input: unknown): Promise<VoiceProfile> {
    const parsed = SaveVoiceProfileInputSchema.parse(input);
    const speakers = await this.client.speakers();
    const selection = this.#selection(speakers, parsed.speakerUuid, parsed.styleId);
    const profile: VoiceProfile = {
      schemaVersion: 1,
      profileName: parsed.profileName,
      engine: 'voicevox',
      endpoint: this.client.endpoint,
      speakerUuid: selection.speaker.speaker_uuid,
      speakerName: selection.speaker.name,
      styleId: selection.style.id,
      styleName: selection.style.name,
      parameters: parsed.parameters,
      updatedAt: new Date().toISOString(),
    };
    return this.repository.saveProfile(profile);
  }

  async createAudioQuery(text: string, styleId: number, parameters: VoiceParameters = {}) {
    return this.client.audioQuery(text, styleId, parameters);
  }

  async synthesize(styleId: number, query: Record<string, unknown>) {
    return this.client.synthesis(styleId, query);
  }

  async preview(text: string, styleId: number, parameters: VoiceParameters = {}) {
    const query = await this.createAudioQuery(text, styleId, parameters);
    return this.synthesize(styleId, query);
  }

  async generate(input: unknown) {
    const parsed: GenerateSentencesInput = GenerateSentencesInputSchema.parse(input);
    const profile = this.repository.loadProfile();
    if (!profile) throw new VoicevoxError('PROFILE_REQUIRED', '먼저 VOICEVOX 보이스 프로필을 선택해 저장하세요.', 'selection', 409, false);
    if (profile.endpoint !== this.client.endpoint) {
      throw new VoicevoxError('PROFILE_ENDPOINT_CHANGED', 'VOICEVOX 연결 주소가 변경되어 보이스 프로필을 다시 선택해야 합니다.', 'selection', 409, false);
    }
    const speakers = await this.client.speakers();
    this.#selection(speakers, profile.speakerUuid, profile.styleId);
    const directory = this.repository.createGenerationDirectory(parsed.contentId);
    const generatedAt = new Date().toISOString();
    const entries: Array<Record<string, unknown>> = [];
    try {
      for (let index = 0; index < parsed.sentences.length; index += 1) {
        const sentence = parsed.sentences[index]!;
        const parameters = { ...profile.parameters, ...sentence.parameters };
        const query = await this.client.audioQuery(sentence.text, profile.styleId, parameters);
        const wav = await this.client.synthesis(profile.styleId, query);
        const fileName = `${String(index + 1).padStart(3, '0')}_${sentence.id}.wav`;
        const path = this.repository.writeWav(directory, fileName, wav);
        entries.push({ order: index + 1, id: sentence.id, text: sentence.text, parameters, audioQuery: query,
          fileName, path, byteLength: wav.length, sha256: createHash('sha256').update(wav).digest('hex') });
      }
      const manifest = { schemaVersion: 1, engine: 'voicevox', contentId: parsed.contentId, generatedAt,
        profile, sentences: entries };
      const manifestPath = this.repository.writeManifest(directory, 'tts_manifest.json', manifest);
      return { manifestPath, manifest };
    } catch (error) {
      const known = error instanceof VoicevoxError ? error
        : new VoicevoxError('TTS_GENERATION_FAILED', 'TTS 생성에 실패했습니다.', 'invalid_response', 502, true);
      this.repository.writeManifest(directory, 'tts_manifest.failed.json', {
        schemaVersion: 1, engine: 'voicevox', contentId: parsed.contentId, generatedAt, profile,
        sentences: parsed.sentences, completed: entries, error: known.toJSON(),
      });
      throw known;
    }
  }

  #selection(speakers: VoicevoxSpeaker[], speakerUuid: string, styleId: number) {
    const speaker = speakers.find(item => item.speaker_uuid === speakerUuid);
    const style = speaker?.styles.find(item => item.id === styleId);
    if (!speaker || !style) throw new VoicevoxError('VOICE_SELECTION_MISSING', '저장된 화자 또는 스타일이 없어 다시 선택해야 합니다.', 'selection', 409, false);
    return { speaker, style };
  }
}
