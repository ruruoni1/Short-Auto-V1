import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { ZodType } from 'zod';
import type { SourceClip } from '../clips/models.js';
import type { SourceFrame } from '../source-frames/models.js';
import {
  ContentPlanSchema,
  CreateContentPlanInputSchema,
  UpdateContentPlanInputSchema,
  type ContentPlan,
  type ContentPlanStatus,
} from './models.js';

const CONTENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const FINAL_STATUSES = new Set<ContentPlanStatus>(['READY', 'PUBLISHED']);

export class ContentPlanError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ContentPlanError';
    this.code = code;
    this.status = status;
  }
}

export interface ContentPlanWarning {
  code: 'SOURCE_FRAME_UNCHECKED';
  message: string;
  sourceFrameId: string;
}

interface ContentPlanDependencies {
  clips: Pick<{ getClip(id: string): SourceClip }, 'getClip'>;
  frames: Pick<{ getFrame(id: string): SourceFrame }, 'getFrame'>;
}

function invalidInput<T>(input: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const prefix = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw new ContentPlanError('INVALID_INPUT', `${prefix}${issue?.message ?? 'Invalid input'}`);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as T;
}

export class ContentPlanRepository {
  readonly #root: string;
  readonly #dependencies: ContentPlanDependencies;

  constructor(projectRoot: string, dependencies: ContentPlanDependencies) {
    this.#root = resolve(projectRoot, 'data', 'content-plans');
    this.#dependencies = dependencies;
    mkdirSync(this.#root, { recursive: true });
  }

  listContentPlans(): ContentPlan[] {
    return readdirSync(this.#root, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => this.#read(entry.name.slice(0, -5)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.contentId.localeCompare(right.contentId));
  }

  getContentPlan(contentId: string): ContentPlan {
    this.#assertId(contentId);
    return structuredClone(this.#read(contentId));
  }

  createContentPlan(input: unknown): ContentPlan {
    const parsed = invalidInput(input, CreateContentPlanInputSchema);
    const file = this.#file(parsed.contentId);
    if (existsSync(file)) throw new ContentPlanError('CONTENT_PLAN_EXISTS', '이미 존재하는 콘텐츠 계획입니다.', 409);
    const timestamp = new Date().toISOString();
    const plan = ContentPlanSchema.parse(compact({ ...parsed, createdAt: timestamp, updatedAt: timestamp }));
    this.#validateSources(plan);
    this.#writeNew(plan);
    return structuredClone(plan);
  }

  updateContentPlan(contentId: string, input: unknown): ContentPlan {
    this.#assertId(contentId);
    const parsed = invalidInput(input, UpdateContentPlanInputSchema);
    return this.#withLock(contentId, () => {
      const current = this.#read(contentId);
      const patch = compact(parsed as Record<string, unknown>);
      const next = ContentPlanSchema.parse({
        ...current,
        ...patch,
        ...(parsed.hookText === null ? { hookText: undefined } : {}),
        ...(parsed.sourceClipId === null ? { sourceClipId: undefined } : {}),
        ...(parsed.sourceFrameId === null ? { sourceFrameId: undefined } : {}),
        ...(parsed.publishedAt === null ? { publishedAt: undefined } : {}),
        updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
      });
      this.#validateSources(next);
      this.#write(next);
      return structuredClone(next);
    });
  }

  warningsFor(plan: ContentPlan): ContentPlanWarning[] {
    if (!plan.sourceFrameId) return [];
    this.#validateSources(plan);
    const frame = this.#dependencies.frames.getFrame(plan.sourceFrameId);
    return frame.rightsReviewStatus === 'unchecked' ? [{
      code: 'SOURCE_FRAME_UNCHECKED',
      message: '소스 프레임 권리 검수가 완료되지 않았습니다. 최종 렌더와 READY/PUBLISHED 전환은 차단됩니다.',
      sourceFrameId: frame.id,
    }] : [];
  }

  #validateSources(plan: ContentPlan): void {
    let explicitClip: SourceClip | null = null;
    if (plan.sourceClipId) explicitClip = this.#dependencies.clips.getClip(plan.sourceClipId);
    if (!plan.sourceFrameId) return;
    const frame = this.#dependencies.frames.getFrame(plan.sourceFrameId);
    this.#dependencies.clips.getClip(frame.sourceClipId);
    if (explicitClip && frame.sourceClipId !== explicitClip.id) {
      throw new ContentPlanError('SOURCE_CLIP_FRAME_MISMATCH', '소스 프레임이 지정한 소스 클립에 속하지 않습니다.', 409);
    }
    if (frame.rightsReviewStatus === 'rejected') {
      throw new ContentPlanError('SOURCE_FRAME_REJECTED', '거부된 소스 프레임은 사용할 수 없습니다.', 409);
    }
    if (FINAL_STATUSES.has(plan.status) && frame.rightsReviewStatus !== 'reviewed') {
      throw new ContentPlanError('SOURCE_FRAME_REVIEW_REQUIRED', 'READY/PUBLISHED 상태에는 권리 검수가 완료된 소스 프레임만 사용할 수 있습니다.', 409);
    }
  }

  #read(contentId: string): ContentPlan {
    const file = this.#file(contentId);
    if (!existsSync(file)) throw new ContentPlanError('CONTENT_PLAN_NOT_FOUND', '콘텐츠 계획을 찾을 수 없습니다.', 404);
    try {
      const plan = ContentPlanSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (plan.contentId !== contentId) throw new Error('identity mismatch');
      return plan;
    } catch (error) {
      if (error instanceof ContentPlanError) throw error;
      throw new ContentPlanError('CONTENT_PLAN_CORRUPT', '저장된 콘텐츠 계획을 읽을 수 없습니다.', 500);
    }
  }

  #writeNew(plan: ContentPlan): void {
    const file = this.#file(plan.contentId);
    try { writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ContentPlanError('CONTENT_PLAN_EXISTS', '이미 존재하는 콘텐츠 계획입니다.', 409);
      throw new ContentPlanError('STORAGE_UNAVAILABLE', '콘텐츠 계획 저장소를 사용할 수 없습니다.', 500);
    }
  }

  #write(plan: ContentPlan): void {
    const file = this.#file(plan.contentId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  #withLock<T>(contentId: string, operation: () => T): T {
    const lock = join(this.#root, `.${contentId}.lock`);
    let descriptor: number;
    try { descriptor = openSync(lock, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ContentPlanError('CONTENT_PLAN_BUSY', '다른 작업이 이 콘텐츠 계획을 저장하고 있습니다.', 409);
      throw new ContentPlanError('STORAGE_UNAVAILABLE', '콘텐츠 계획 저장소를 사용할 수 없습니다.', 500);
    }
    try { return operation(); }
    finally { closeSync(descriptor); rmSync(lock, { force: true }); }
  }

  #assertId(contentId: string): void {
    if (!CONTENT_ID.test(contentId)) throw new ContentPlanError('INVALID_INPUT', '콘텐츠 ID를 확인하세요.');
  }

  #file(contentId: string): string {
    this.#assertId(contentId);
    return join(this.#root, `${contentId}.json`);
  }
}
