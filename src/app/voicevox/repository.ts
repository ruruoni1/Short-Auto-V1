import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { VoiceProfileSchema, VoicevoxError, parseVoicevoxEndpoint, type VoiceProfile } from './models.js';

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    throw new VoicevoxError('TTS_STORAGE_FAILED', 'VOICEVOX 설정 또는 결과를 저장하지 못했습니다.', 'storage', 500, true);
  }
}

export class VoicevoxRepository {
  readonly #root: string;
  readonly #profilePath: string;
  readonly #outputRoot: string;

  constructor(projectRoot: string) {
    this.#root = resolve(projectRoot);
    this.#profilePath = this.#inside('data', 'voicevox', 'profile.json');
    this.#outputRoot = this.#inside('output', 'tts');
    mkdirSync(dirname(this.#profilePath), { recursive: true });
    mkdirSync(this.#outputRoot, { recursive: true });
  }

  loadProfile(): VoiceProfile | null {
    if (!existsSync(this.#profilePath)) return null;
    try {
      const profile = VoiceProfileSchema.parse(JSON.parse(readFileSync(this.#profilePath, 'utf8')));
      parseVoicevoxEndpoint(profile.endpoint);
      return profile;
    }
    catch { throw new VoicevoxError('PROFILE_CORRUPT', '저장된 VOICEVOX 프로필을 읽을 수 없습니다.', 'storage', 500, false); }
  }

  saveProfile(profile: VoiceProfile): VoiceProfile {
    const parsed = VoiceProfileSchema.parse(profile);
    parseVoicevoxEndpoint(parsed.endpoint);
    atomicJson(this.#profilePath, parsed);
    return structuredClone(parsed);
  }

  createGenerationDirectory(contentId: string): string {
    const directory = this.#inside('output', 'tts', contentId);
    try { mkdirSync(directory, { recursive: false }); }
    catch (error) {
      if (existsSync(directory)) throw new VoicevoxError('TTS_OUTPUT_EXISTS', '같은 콘텐츠 ID의 TTS 출력이 이미 있습니다.', 'storage', 409, false);
      throw new VoicevoxError('TTS_STORAGE_FAILED', 'TTS 출력 폴더를 만들지 못했습니다.', 'storage', 500, true);
    }
    return directory;
  }

  writeWav(directory: string, fileName: string, bytes: Buffer): string {
    const target = resolve(directory, fileName);
    if (dirname(target) !== resolve(directory) || !/^\d{3}_[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.wav$/.test(fileName)) {
      throw new VoicevoxError('TTS_PATH_INVALID', 'TTS 출력 파일 경로가 올바르지 않습니다.', 'storage', 400, false);
    }
    try { writeFileSync(target, bytes, { flag: 'wx' }); }
    catch { throw new VoicevoxError('TTS_STORAGE_FAILED', 'TTS 음성 파일을 저장하지 못했습니다.', 'storage', 500, true); }
    return this.#relative(target);
  }

  writeManifest(directory: string, name: 'tts_manifest.json' | 'tts_manifest.failed.json', value: unknown): string {
    const target = resolve(directory, name);
    if (dirname(target) !== resolve(directory)) throw new VoicevoxError('TTS_PATH_INVALID', 'TTS manifest 경로가 올바르지 않습니다.', 'storage', 400, false);
    atomicJson(target, value);
    return this.#relative(target);
  }

  #inside(...segments: string[]): string {
    const target = resolve(this.#root, ...segments);
    const path = relative(this.#root, target);
    if (!path || path === '..' || path.startsWith(`..${sep}`) || resolve(target) === this.#root) {
      throw new VoicevoxError('TTS_PATH_INVALID', '프로젝트 밖의 경로는 사용할 수 없습니다.', 'storage', 400, false);
    }
    return target;
  }

  #relative(target: string): string {
    const path = relative(this.#root, target);
    if (!path || path === '..' || path.startsWith(`..${sep}`)) throw new VoicevoxError('TTS_PATH_INVALID', '프로젝트 밖의 경로는 저장할 수 없습니다.', 'storage', 500, false);
    return path.split(sep).join('/');
  }
}
