import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { SourceRepository } from '../clips/repository.js';
import { CreateSourceFrameInputSchema, type SourceFrame } from './models.js';
import { FrameImageError, inspectFrameImage } from './image.js';
import { SourceFrameError, type SourceFrameRepository } from './repository.js';
import { extractFrame, probeDurationMs, runFrameProcess, type FrameProcessRunner } from './runner.js';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface CreateSourceFrameResult {
  frame: SourceFrame;
  reused: boolean;
}

export interface SourceFrameImage {
  frame: SourceFrame;
  bytes: Buffer;
}

function inside(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

function assertNoSymlink(root: string, target: string): void {
  const path = relative(root, target);
  if (!inside(root, target) || !path) throw new SourceFrameError('SOURCE_PATH_INVALID', '원본 영상 경로를 확인하세요.');
  let current = root;
  for (const part of path.split(sep)) {
    current = join(current, part);
    if (!existsSync(current)) throw new SourceFrameError('SOURCE_MEDIA_NOT_FOUND', '다운로드된 원본 영상을 찾을 수 없습니다.', 409);
    if (lstatSync(current).isSymbolicLink()) throw new SourceFrameError('SOURCE_PATH_INVALID', '심볼릭 링크 원본은 사용할 수 없습니다.');
  }
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (!inside(realRoot, realTarget)) throw new SourceFrameError('SOURCE_PATH_INVALID', '원본 영상 경로를 확인하세요.');
}

function resolveSourceFile(projectRoot: string, localPath: string): string {
  if (!localPath || isAbsolute(localPath) || /^(?:[A-Za-z]:|[\\/])/.test(localPath)
    || localPath.split(/[\\/]/).includes('..')) {
    throw new SourceFrameError('SOURCE_PATH_INVALID', '원본 영상은 프로젝트 상대경로여야 합니다.');
  }
  const root = resolve(projectRoot);
  const target = resolve(root, ...localPath.split(/[\\/]/));
  assertNoSymlink(root, target);
  const stat = statSync(target);
  if (!stat.isFile() || stat.size <= 0) throw new SourceFrameError('SOURCE_MEDIA_NOT_FOUND', '다운로드된 원본 영상을 찾을 수 없습니다.', 409);
  return target;
}

function ensureSafeDirectory(root: string, segments: readonly string[]): string {
  let current = root;
  for (const segment of segments) {
    if (!SAFE_SEGMENT.test(segment)) throw new SourceFrameError('OUTPUT_PATH_INVALID', '프레임 저장 경로를 만들 수 없습니다.', 500);
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new SourceFrameError('OUTPUT_PATH_INVALID', '프레임 저장 경로를 만들 수 없습니다.', 500);
  }
  return current;
}

function relativePath(root: string, target: string): string {
  const value = relative(root, target);
  if (!value || value.startsWith(`..${sep}`) || value === '..' || isAbsolute(value)) {
    throw new SourceFrameError('OUTPUT_PATH_INVALID', '프레임 출력이 프로젝트를 벗어났습니다.', 500);
  }
  return value.split(sep).join('/');
}

export class SourceFrameService {
  readonly #root: string;
  readonly #clips: Pick<SourceRepository, 'getClip'>;
  readonly #frames: SourceFrameRepository;
  readonly #run: FrameProcessRunner;

  constructor(options: {
    projectRoot: string;
    clips: Pick<SourceRepository, 'getClip'>;
    frames: SourceFrameRepository;
    run?: FrameProcessRunner;
  }) {
    this.#root = resolve(options.projectRoot);
    this.#clips = options.clips;
    this.#frames = options.frames;
    this.#run = options.run ?? runFrameProcess;
  }

  listFrames(query: unknown = {}): SourceFrame[] {
    return this.#frames.listFrames(query);
  }

  getFrame(id: string): SourceFrame {
    return this.#frames.getFrame(id);
  }

  reviewFrame(id: string, input: unknown): SourceFrame {
    return this.#frames.reviewFrame(id, input);
  }

  getFrameImage(id: string): SourceFrameImage {
    const frame = this.#frames.getFrame(id);
    let path: string;
    try { path = resolveSourceFile(this.#root, frame.localPath); }
    catch {
      throw new SourceFrameError('SOURCE_FRAME_FILE_INVALID', '저장된 소스 프레임 파일을 읽을 수 없습니다.', 500);
    }
    const bytes = readFileSync(path);
    try {
      const image = inspectFrameImage(bytes, frame.format);
      if (image.mimeType !== frame.mimeType || image.width !== frame.width || image.height !== frame.height
        || image.bytes.length !== frame.byteLength || image.sha256 !== frame.sha256) {
        throw new FrameImageError('stored frame mismatch');
      }
    } catch {
      throw new SourceFrameError('SOURCE_FRAME_FILE_INVALID', '저장된 소스 프레임 파일이 기록과 일치하지 않습니다.', 500);
    }
    return { frame, bytes };
  }

  async createFrame(sourceClipId: string, input: unknown): Promise<CreateSourceFrameResult> {
    if (!SAFE_SEGMENT.test(sourceClipId)) throw new SourceFrameError('INVALID_INPUT', '클립 ID를 확인하세요.');
    const parsed = CreateSourceFrameInputSchema.safeParse(input);
    if (!parsed.success) throw new SourceFrameError('INVALID_INPUT', '프레임 시점과 형식을 확인하세요.');
    const clip = this.#clips.getClip(sourceClipId);
    if (!['SELECTED', 'DOWNLOADED'].includes(clip.status)) {
      throw new SourceFrameError('CLIP_NOT_SELECTED', '사람이 채택한 클립에서만 프레임을 추출할 수 있습니다.', 409);
    }
    if (!clip.localVideoPath) throw new SourceFrameError('CLIP_MEDIA_REQUIRED', '먼저 채택한 클립의 영상을 다운로드하세요.', 409);
    if (clip.durationSeconds !== null && parsed.data.timestampMs >= clip.durationSeconds * 1_000) {
      throw new SourceFrameError('FRAME_TIMESTAMP_OUT_OF_RANGE', '프레임 시점이 영상 길이를 벗어났습니다.');
    }
    const sourcePath = resolveSourceFile(this.#root, clip.localVideoPath);
    const existing = this.#frames.findByClipTimestamp(sourceClipId, parsed.data.timestampMs);
    if (existing) return { frame: existing, reused: true };

    let durationMs: number;
    try { durationMs = await probeDurationMs(sourcePath, dirname(sourcePath), this.#run); }
    catch { throw new SourceFrameError('FRAME_PROBE_FAILED', '원본 영상 길이를 확인하지 못했습니다. FFprobe 설치와 파일 상태를 확인하세요.', 502); }
    if (parsed.data.timestampMs >= durationMs) {
      throw new SourceFrameError('FRAME_TIMESTAMP_OUT_OF_RANGE', '프레임 시점이 영상 길이를 벗어났습니다.');
    }

    const operationId = randomUUID();
    const tempRoot = ensureSafeDirectory(this.#root, ['temp', 'source-frames', operationId]);
    const tempFile = join(tempRoot, `frame.${parsed.data.format === 'jpeg' ? 'jpg' : 'png'}`);
    let finalFile: string | null = null;
    try {
      try { await extractFrame(sourcePath, tempFile, parsed.data.timestampMs, parsed.data.format, tempRoot, this.#run); }
      catch { throw new SourceFrameError('FRAME_EXTRACTION_FAILED', '프레임 추출에 실패했습니다. FFmpeg 설치와 원본 파일을 확인하세요.', 502); }
      if (!existsSync(tempFile)) throw new SourceFrameError('FRAME_OUTPUT_MISSING', '프레임 이미지가 생성되지 않았습니다.', 502);
      let image;
      try { image = inspectFrameImage(readFileSync(tempFile), parsed.data.format); }
      catch (error) {
        if (error instanceof FrameImageError) throw new SourceFrameError('FRAME_IMAGE_INVALID', '생성된 프레임 이미지가 올바르지 않습니다.', 502);
        throw error;
      }
      const frameId = randomUUID();
      const outputDirectory = ensureSafeDirectory(this.#root, ['assets', 'frames', sourceClipId]);
      finalFile = join(outputDirectory, `${frameId}.${image.extension}`);
      renameSync(tempFile, finalFile);
      const inserted = this.#frames.insertFrame({
        id: frameId,
        sourceClipId,
        sourceChannelId: clip.channelId,
        youtubeVideoId: clip.youtubeVideoId,
        timestampMs: parsed.data.timestampMs,
        localPath: relativePath(this.#root, finalFile),
        format: image.format,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        byteLength: image.bytes.length,
        sha256: image.sha256,
        candidateType: parsed.data.candidateType,
        rightsReviewStatus: 'unchecked',
        rightsReviewNotes: parsed.data.rightsReviewNotes,
        workTitle: clip.workTitle,
        episode: clip.episode,
        sourceUrl: clip.youtubeUrl,
      });
      if (!inserted.created) rmSync(finalFile, { force: true });
      return { frame: inserted.frame, reused: !inserted.created };
    } catch (error) {
      if (finalFile) rmSync(finalFile, { force: true });
      if (error instanceof SourceFrameError) throw error;
      throw new SourceFrameError('FRAME_STORAGE_FAILED', '소스 프레임을 저장하지 못했습니다.', 500);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}
