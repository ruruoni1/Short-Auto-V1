import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { ZodType } from 'zod';
import {
  CreateThumbnailProjectInputSchema,
  CreateThumbnailVariantInputSchema,
  FontRegistryEntrySchema,
  RevisionInputSchema,
  SourceFrameReferenceSchema,
  StoreThumbnailExportInputSchema,
  ThumbnailProjectSchema,
  ThumbnailTemplateSchema,
  UpdateThumbnailProjectInputSchema,
  UploadBaseImageInputSchema,
  type BaseImageTransform,
  type FontRegistryEntry,
  type SourceFrameReference,
  type TextLayer,
  type ThumbnailProject,
  type ThumbnailTemplate,
} from './models.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64_000_000;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export class ThumbnailRepositoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ThumbnailRepositoryError';
    this.code = code;
    this.status = status;
  }
}

export interface VerifiedSourceFrameInput {
  reference: SourceFrameReference;
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw new ThumbnailRepositoryError('INVALID_INPUT', `${path}${issue?.message ?? 'Invalid input'}`);
}

function layer(id: string, geometry: Pick<TextLayer, 'x' | 'y' | 'width' | 'height'>, size: number, align: TextLayer['align']): TextLayer {
  return {
    id,
    type: 'text',
    text: '',
    ...geometry,
    rotation: 0,
    fontFamily: 'sans-serif',
    fontWeight: 800,
    fontSize: size,
    color: '#FFFFFF',
    align,
    letterSpacing: 0,
    lineHeight: 1.05,
    strokeColor: '#111111',
    strokeWidth: 4,
    shadow: { enabled: true, x: 2, y: 3, blur: 6, opacity: 0.35 },
    locked: false,
    visible: true,
  };
}

const LANDSCAPE = { width: 1280, height: 720 } as const;
const PORTRAIT = { width: 1080, height: 1920 } as const;

export const THUMBNAIL_TEMPLATES: readonly ThumbnailTemplate[] = Object.freeze([
  ThumbnailTemplateSchema.parse({
    id: 'discovery_long_v1', name: 'Discovery Long', description: '질문·반전 중심의 16:9 발견형 구도', contentType: 'discovery_long',
    canvas: LANDSCAPE, safeArea: { x: 64, y: 54, width: 1152, height: 612 },
    defaultLayers: [layer('text_primary', { x: 64, y: 90, width: 650, height: 230 }, 88, 'left')],
  }),
  ThumbnailTemplateSchema.parse({
    id: 'training_long_v1', name: 'Training Long', description: '학습 내용과 분량이 선명한 16:9 훈련형 구도', contentType: 'training_long',
    canvas: LANDSCAPE, safeArea: { x: 64, y: 54, width: 1152, height: 612 },
    defaultLayers: [
      layer('text_primary', { x: 70, y: 105, width: 720, height: 190 }, 76, 'left'),
      layer('text_support', { x: 74, y: 315, width: 540, height: 110 }, 46, 'left'),
    ],
  }),
  ThumbnailTemplateSchema.parse({
    id: 'shorts_discovery_v1', name: 'Shorts Discovery', description: '한 질문을 크게 보여주는 9:16 발견형 구도', contentType: 'discovery_short',
    canvas: PORTRAIT, safeArea: { x: 86, y: 160, width: 908, height: 1450 },
    defaultLayers: [layer('text_primary', { x: 90, y: 220, width: 900, height: 420 }, 104, 'center')],
  }),
  ThumbnailTemplateSchema.parse({
    id: 'shorts_learning_v1', name: 'Shorts Learning', description: '표현과 뜻을 분리하는 9:16 학습형 구도', contentType: 'learning_short',
    canvas: PORTRAIT, safeArea: { x: 86, y: 160, width: 908, height: 1450 },
    defaultLayers: [
      layer('text_primary', { x: 90, y: 235, width: 900, height: 320 }, 100, 'center'),
      layer('text_support', { x: 130, y: 590, width: 820, height: 220 }, 64, 'center'),
    ],
  }),
]);

interface ImageInfo {
  format: 'png' | 'jpeg';
  mimeType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
  width: number;
  height: number;
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Buffer): ImageInfo | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  let offset = 8;
  let hasData = false;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_IMAGE_BYTES || offset + length + 12 > bytes.length) return null;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const expectedCrc = bytes.readUInt32BE(offset + length + 8);
    if (crc32(bytes.subarray(offset + 4, offset + length + 8)) !== expectedCrc) return null;
    if (type === 'IDAT') hasData = true;
    if (type === 'IEND') { hasEnd = length === 0 && offset + 12 === bytes.length; break; }
    offset += length + 12;
  }
  if (!hasData || !hasEnd) return null;
  return { format: 'png', mimeType: 'image/png', extension: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function inspectJpeg(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (sof.has(marker)) {
      if (length < 7) return null;
      dimensions = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    if (marker === 0xda) {
      const scanStart = offset + length;
      if (!dimensions || scanStart >= bytes.length - 2) return null;
      return { format: 'jpeg', mimeType: 'image/jpeg', extension: 'jpg', ...dimensions };
    }
    offset += length;
  }
  return null;
}

function inspectImage(input: Uint8Array): { bytes: Buffer; info: ImageInfo; sha256: string } {
  const bytes = Buffer.from(input);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new ThumbnailRepositoryError('INVALID_IMAGE', '이미지는 20MB 이하여야 합니다.');
  }
  const info = inspectPng(bytes) ?? inspectJpeg(bytes);
  if (!info || info.width < 1 || info.height < 1 || info.width > 16_384 || info.height > 16_384
    || info.width * info.height > MAX_IMAGE_PIXELS) {
    throw new ThumbnailRepositoryError('INVALID_IMAGE', '유효한 PNG 또는 JPEG 이미지인지 확인하세요.');
  }
  return { bytes, info, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** JSON and binary persistence for the layer-based Thumbnail Studio. */
export class ThumbnailRepository {
  readonly #root: string;
  readonly #projectsRoot: string;
  readonly #fonts: readonly FontRegistryEntry[];

  constructor(projectRoot: string, fonts: readonly unknown[] = []) {
    this.#root = resolve(projectRoot);
    this.#projectsRoot = join(this.#root, 'data', 'thumbnail-projects');
    this.#fonts = Object.freeze(fonts.map(item => FontRegistryEntrySchema.parse(item)));
    mkdirSync(this.#projectsRoot, { recursive: true });
  }

  listTemplates(): ThumbnailTemplate[] {
    return THUMBNAIL_TEMPLATES.map(template => this.#materializeTemplate(template));
  }

  /** Empty by default: fonts are listed only after a verified registry is injected. */
  listFonts(): FontRegistryEntry[] {
    return clone([...this.#fonts]);
  }

  listProjects(): ThumbnailProject[] {
    const projects: ThumbnailProject[] = [];
    for (const entry of readdirSync(this.#projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue;
      const file = join(this.#projectsRoot, entry.name, 'project.json');
      if (!existsSync(file)) continue;
      projects.push(this.#readProject(entry.name));
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  getProject(projectId: string): ThumbnailProject {
    this.#assertId(projectId);
    return clone(this.#readProject(projectId));
  }

  createProject(input: unknown): ThumbnailProject {
    const parsed = parseInput(CreateThumbnailProjectInputSchema, input);
    const templateDefinition = THUMBNAIL_TEMPLATES.find(item => item.id === parsed.templateId);
    if (!templateDefinition) throw new ThumbnailRepositoryError('TEMPLATE_NOT_FOUND', '템플릿을 찾을 수 없습니다.', 404);
    const template = this.#materializeTemplate(templateDefinition);
    if (parsed.variantOfProjectId !== null) {
      throw new ThumbnailRepositoryError('VARIANT_ENDPOINT_REQUIRED', 'A/B 변형은 원본 프로젝트의 variant API로 생성하세요.');
    }
    this.#assertPrimaryAvailable(parsed.contentId);
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const project = parseInput(ThumbnailProjectSchema, {
      schemaVersion: 1,
      id,
      contentId: parsed.contentId,
      channelProfile: parsed.channelProfile,
      templateId: template.id,
      name: parsed.name,
      canvas: template.canvas,
      safeArea: template.safeArea,
      safeAreaVisible: true,
      baseImage: null,
      layers: template.defaultLayers,
      exports: [],
      variantOfProjectId: parsed.variantOfProjectId,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
    });
    const directory = this.#projectDirectory(id);
    mkdirSync(directory);
    mkdirSync(join(directory, 'assets'));
    mkdirSync(join(directory, 'exports'));
    try { this.#writeProject(project); }
    catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
    return clone(project);
  }

  /** Creates an independent A/B copy without changing the source project. */
  createVariant(projectId: string, input: unknown): ThumbnailProject {
    this.#assertId(projectId);
    const parsed = parseInput(CreateThumbnailVariantInputSchema, input);
    return this.#withLock(projectId, () => {
      const source = this.#readProject(projectId);
      this.#assertSourceFrameUsable(source);
      const baseBytes = source.baseImage ? this.#readVerifiedBaseImage(source) : null;
      const id = randomUUID();
      const timestamp = new Date(Math.max(
        Date.now(),
        Date.parse(source.createdAt) + 1,
        Date.parse(source.updatedAt) + 1,
      )).toISOString();
      const directory = this.#projectDirectory(id);
      const baseFileName = source.baseImage === null ? null
        : `base-${source.baseImage.sha256.slice(0, 16)}-${id.slice(0, 8)}.${source.baseImage.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      const baseImage = source.baseImage === null ? null : {
        ...clone(source.baseImage),
        fileName: baseFileName!,
        path: this.#relativePath(join(directory, 'assets', baseFileName!)),
      };
      const variant = parseInput(ThumbnailProjectSchema, {
        ...clone(source),
        id,
        name: parsed.name ?? source.name,
        channelProfile: parsed.channelProfile ?? source.channelProfile,
        baseImage,
        exports: [],
        variantOfProjectId: source.variantOfProjectId ?? source.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 0,
      });
      this.#assertLayerFonts(variant.layers);
      let createdDirectory = false;
      try {
        mkdirSync(directory);
        createdDirectory = true;
        mkdirSync(join(directory, 'assets'));
        mkdirSync(join(directory, 'exports'));
        if (baseBytes && variant.baseImage) {
          this.#writeBinary(join(directory, 'assets', variant.baseImage.fileName), baseBytes);
        }
        this.#writeProject(variant);
        return clone(variant);
      } catch (error) {
        if (createdDirectory) rmSync(directory, { recursive: true, force: true });
        if (error instanceof ThumbnailRepositoryError) throw error;
        throw new ThumbnailRepositoryError('STORAGE_UNAVAILABLE', '프로젝트 저장소를 사용할 수 없습니다.', 500);
      }
    });
  }

  /** Atomically creates a project with an independently persisted, verified official frame copy. */
  createProjectFromSourceFrame(input: unknown, source: VerifiedSourceFrameInput): ThumbnailProject {
    const parsed = parseInput(CreateThumbnailProjectInputSchema, input);
    if (parsed.variantOfProjectId !== null) {
      throw new ThumbnailRepositoryError('INVALID_INPUT', '소스 프레임 프로젝트 생성에는 variant 원본을 지정할 수 없습니다.');
    }
    const templateDefinition = THUMBNAIL_TEMPLATES.find(item => item.id === parsed.templateId);
    if (!templateDefinition) throw new ThumbnailRepositoryError('TEMPLATE_NOT_FOUND', '템플릿을 찾을 수 없습니다.', 404);
    const template = this.#materializeTemplate(templateDefinition);
    const reference = parseInput(SourceFrameReferenceSchema, source.reference);
    if (reference.rightsReviewStatus === 'rejected') {
      throw new ThumbnailRepositoryError('SOURCE_FRAME_REJECTED', '거부된 소스 프레임은 사용할 수 없습니다.', 409);
    }
    this.#assertPrimaryAvailable(parsed.contentId);
    const inspected = inspectImage(source.bytes);
    if (inspected.info.mimeType !== source.mimeType || inspected.info.width !== source.width
      || inspected.info.height !== source.height || inspected.bytes.length !== source.byteLength
      || inspected.sha256 !== source.sha256) {
      throw new ThumbnailRepositoryError('SOURCE_FRAME_IMAGE_MISMATCH', '소스 프레임 이미지가 검증된 기록과 일치하지 않습니다.', 500);
    }
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const extension = inspected.info.extension;
    const fileName = `base-${inspected.sha256.slice(0, 16)}.${extension}`;
    const directory = this.#projectDirectory(id);
    const destination = join(directory, 'assets', fileName);
    const project = parseInput(ThumbnailProjectSchema, {
      schemaVersion: 1,
      id,
      contentId: parsed.contentId,
      channelProfile: parsed.channelProfile,
      templateId: template.id,
      name: parsed.name,
      canvas: template.canvas,
      safeArea: template.safeArea,
      safeAreaVisible: true,
      baseImage: {
        sourceType: 'OFFICIAL_CLIP_FRAME',
        fileName,
        path: this.#relativePath(destination),
        mimeType: inspected.info.mimeType,
        width: inspected.info.width,
        height: inspected.info.height,
        byteLength: inspected.bytes.length,
        sha256: inspected.sha256,
        transform: this.#defaultBaseTransform(template.canvas, inspected.info),
        sourceFrame: reference,
        createdAt: timestamp,
      },
      layers: template.defaultLayers,
      exports: [],
      variantOfProjectId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
    });
    let createdDirectory = false;
    try {
      mkdirSync(directory);
      createdDirectory = true;
      mkdirSync(join(directory, 'assets'));
      mkdirSync(join(directory, 'exports'));
      this.#writeBinary(destination, inspected.bytes);
      this.#writeProject(project);
      return clone(project);
    } catch (error) {
      if (createdDirectory) rmSync(directory, { recursive: true, force: true });
      if (error instanceof ThumbnailRepositoryError) throw error;
      throw new ThumbnailRepositoryError('STORAGE_UNAVAILABLE', '프로젝트 저장소를 사용할 수 없습니다.', 500);
    }
  }

  updateProject(projectId: string, input: unknown): ThumbnailProject {
    this.#assertId(projectId);
    const parsed = parseInput(UpdateThumbnailProjectInputSchema, input);
    return this.#withLock(projectId, () => {
      const current = this.#readProject(projectId);
      this.#assertSourceFrameUsable(current);
      this.#assertRevision(current, parsed.expectedRevision);
      if (parsed.layers !== undefined) this.#assertLayerFonts(parsed.layers);
      const timestamp = new Date().toISOString();
      const next = parseInput(ThumbnailProjectSchema, {
        ...current,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.layers === undefined ? {} : { layers: parsed.layers }),
        ...(parsed.safeAreaVisible === undefined ? {} : { safeAreaVisible: parsed.safeAreaVisible }),
        ...(parsed.baseImageTransform === undefined || current.baseImage === null ? {} : {
          baseImage: { ...current.baseImage, transform: parsed.baseImageTransform },
        }),
        updatedAt: timestamp,
        revision: current.revision + 1,
      });
      if (parsed.baseImageTransform !== undefined && current.baseImage === null) {
        throw new ThumbnailRepositoryError('BASE_IMAGE_REQUIRED', '먼저 베이스 이미지를 추가하세요.', 409);
      }
      this.#writeProject(next);
      return clone(next);
    });
  }

  deleteProject(projectId: string, input: unknown): void {
    this.#assertId(projectId);
    const parsed = parseInput(RevisionInputSchema, input);
    this.#withLock(projectId, () => {
      const current = this.#readProject(projectId);
      this.#assertRevision(current, parsed.expectedRevision);
      rmSync(this.#projectDirectory(projectId), { recursive: true, force: false });
    });
  }

  uploadBaseImage(projectId: string, input: unknown) {
    this.#assertId(projectId);
    const parsed = parseInput(UploadBaseImageInputSchema, input);
    const inspected = inspectImage(parsed.bytes);
    const sourceFrame: SourceFrameReference | null = parsed.sourceFrame ?? null;
    if ((parsed.sourceType === 'OFFICIAL_CLIP_FRAME') !== (sourceFrame !== null)) {
      throw new ThumbnailRepositoryError('SOURCE_REFERENCE_REQUIRED', '공식 클립 프레임의 출처와 권리 검수 정보를 입력하세요.');
    }
    if (sourceFrame?.rightsReviewStatus === 'rejected') {
      throw new ThumbnailRepositoryError('SOURCE_FRAME_REJECTED', '거부된 소스 프레임은 사용할 수 없습니다.', 409);
    }
    return this.#withLock(projectId, () => {
      const current = this.#readProject(projectId);
      this.#assertRevision(current, parsed.expectedRevision);
      const timestamp = new Date().toISOString();
      const fileName = `base-${inspected.sha256.slice(0, 16)}.${inspected.info.extension}`;
      const destination = join(this.#projectDirectory(projectId), 'assets', fileName);
      this.#writeBinary(destination, inspected.bytes);
      const next = parseInput(ThumbnailProjectSchema, {
        ...current,
        baseImage: {
          sourceType: parsed.sourceType,
          fileName,
          path: this.#relativePath(destination),
          mimeType: inspected.info.mimeType,
          width: inspected.info.width,
          height: inspected.info.height,
          byteLength: inspected.bytes.length,
          sha256: inspected.sha256,
          transform: current.baseImage?.transform ?? this.#defaultBaseTransform(current.canvas, inspected.info),
          sourceFrame,
          createdAt: timestamp,
        },
        updatedAt: timestamp,
        revision: current.revision + 1,
      });
      try { this.#writeProject(next); }
      catch (error) { if (current.baseImage?.fileName !== fileName) rmSync(destination, { force: true }); throw error; }
      if (current.baseImage && current.baseImage.fileName !== fileName) {
        rmSync(join(this.#projectDirectory(projectId), 'assets', current.baseImage.fileName), { force: true });
      }
      return clone({ project: next, fileName, mimeType: inspected.info.mimeType, width: inspected.info.width, height: inspected.info.height, sha256: inspected.sha256 });
    });
  }

  storeExport(projectId: string, input: unknown) {
    this.#assertId(projectId);
    const parsed = parseInput(StoreThumbnailExportInputSchema, input);
    const inspected = inspectImage(parsed.bytes);
    if (inspected.info.format !== parsed.format) {
      throw new ThumbnailRepositoryError('IMAGE_FORMAT_MISMATCH', '선택한 출력 형식과 이미지 데이터가 다릅니다.');
    }
    return this.#withLock(projectId, () => {
      const current = this.#readProject(projectId);
      if (current.baseImage?.sourceFrame && current.baseImage.sourceFrame.rightsReviewStatus !== 'reviewed') {
        throw new ThumbnailRepositoryError('SOURCE_FRAME_REVIEW_REQUIRED', '최종 렌더에는 권리 검수가 완료된 소스 프레임만 사용할 수 있습니다.', 409);
      }
      this.#assertRevision(current, parsed.expectedRevision);
      if (inspected.info.width !== current.canvas.width || inspected.info.height !== current.canvas.height) {
        throw new ThumbnailRepositoryError('EXPORT_SIZE_MISMATCH', `출력 이미지는 ${current.canvas.width}×${current.canvas.height}px이어야 합니다.`);
      }
      const timestamp = new Date().toISOString();
      const fileName = `thumbnail-r${current.revision}-${inspected.sha256.slice(0, 16)}.${inspected.info.extension}`;
      const destination = join(this.#projectDirectory(projectId), 'exports', fileName);
      this.#writeBinary(destination, inspected.bytes);
      const exportEntry = {
        fileName,
        path: this.#relativePath(destination),
        format: inspected.info.format,
        mimeType: inspected.info.mimeType,
        width: inspected.info.width,
        height: inspected.info.height,
        byteLength: inspected.bytes.length,
        sha256: inspected.sha256,
        productionRevision: current.revision,
        createdAt: timestamp,
      };
      const exports = [...current.exports.filter(item => item.fileName !== fileName), exportEntry].slice(-100);
      const next = parseInput(ThumbnailProjectSchema, { ...current, exports, updatedAt: timestamp, revision: current.revision + 1 });
      try { this.#writeProject(next); }
      catch (error) { if (!current.exports.some(item => item.fileName === fileName)) rmSync(destination, { force: true }); throw error; }
      return clone({ project: next, fileName, mimeType: inspected.info.mimeType, width: inspected.info.width, height: inspected.info.height, sha256: inspected.sha256 });
    });
  }

  getAsset(projectId: string, fileName: string): { bytes: Buffer; mimeType: string } {
    const project = this.getProject(projectId);
    this.#assertSourceFrameUsable(project);
    this.#assertFileName(fileName);
    if (project.baseImage?.fileName !== fileName) throw new ThumbnailRepositoryError('ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.', 404);
    const file = join(this.#projectDirectory(projectId), 'assets', fileName);
    if (!existsSync(file)) throw new ThumbnailRepositoryError('ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.', 404);
    return { bytes: readFileSync(file), mimeType: project.baseImage.mimeType };
  }

  getExport(projectId: string, fileName: string): { bytes: Buffer; mimeType: string } {
    const project = this.getProject(projectId);
    this.#assertFileName(fileName);
    const entry = project.exports.find(item => item.fileName === fileName);
    if (!entry) throw new ThumbnailRepositoryError('EXPORT_NOT_FOUND', '출력 이미지를 찾을 수 없습니다.', 404);
    const file = join(this.#projectDirectory(projectId), 'exports', fileName);
    if (!existsSync(file)) throw new ThumbnailRepositoryError('EXPORT_NOT_FOUND', '출력 이미지를 찾을 수 없습니다.', 404);
    return { bytes: readFileSync(file), mimeType: entry.mimeType };
  }

  #readProject(projectId: string): ThumbnailProject {
    const file = join(this.#projectDirectory(projectId), 'project.json');
    if (!existsSync(file)) throw new ThumbnailRepositoryError('PROJECT_NOT_FOUND', '썸네일 프로젝트를 찾을 수 없습니다.', 404);
    try {
      const project = ThumbnailProjectSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (project.id !== projectId) throw new Error('Project identity mismatch');
      if (project.baseImage) {
        const expected = this.#relativePath(join(this.#projectDirectory(projectId), 'assets', project.baseImage.fileName));
        if (project.baseImage.path !== expected) throw new Error('Base image path mismatch');
      }
      for (const item of project.exports) {
        const expected = this.#relativePath(join(this.#projectDirectory(projectId), 'exports', item.fileName));
        if (item.path !== expected) throw new Error('Export path mismatch');
      }
      return project;
    }
    catch (error) {
      if (error instanceof ThumbnailRepositoryError) throw error;
      throw new ThumbnailRepositoryError('PROJECT_CORRUPT', '저장된 썸네일 프로젝트를 읽을 수 없습니다.', 500);
    }
  }

  #writeProject(project: ThumbnailProject): void {
    const file = join(this.#projectDirectory(project.id), 'project.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  #writeBinary(destination: string, bytes: Buffer): void {
    if (existsSync(destination)) return;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, bytes, { flag: 'wx' });
      renameSync(temporary, destination);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  #readVerifiedBaseImage(project: ThumbnailProject): Buffer {
    const image = project.baseImage;
    if (!image) throw new ThumbnailRepositoryError('ASSET_NOT_FOUND', '베이스 이미지를 찾을 수 없습니다.', 404);
    const file = join(this.#projectDirectory(project.id), 'assets', image.fileName);
    if (!existsSync(file)) throw new ThumbnailRepositoryError('ASSET_NOT_FOUND', '베이스 이미지를 찾을 수 없습니다.', 404);
    let bytes: Buffer;
    try {
      const entry = lstatSync(file);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Base image is not a regular file');
      bytes = readFileSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ThumbnailRepositoryError('ASSET_NOT_FOUND', '베이스 이미지를 찾을 수 없습니다.', 404);
      }
      throw new ThumbnailRepositoryError('ASSET_CORRUPT', '저장된 베이스 이미지가 올바르지 않습니다.', 500);
    }
    try {
      const inspected = inspectImage(bytes);
      const expectedFileName = new RegExp(`^base-${inspected.sha256.slice(0, 16)}(?:-[0-9a-f]{8})?\\.${inspected.info.extension}$`);
      if (!expectedFileName.test(image.fileName) || image.mimeType !== inspected.info.mimeType
        || image.width !== inspected.info.width || image.height !== inspected.info.height
        || image.byteLength !== inspected.bytes.length || image.sha256 !== inspected.sha256) {
        throw new Error('Base image metadata mismatch');
      }
      return inspected.bytes;
    } catch {
      throw new ThumbnailRepositoryError('ASSET_CORRUPT', '저장된 베이스 이미지가 기록과 일치하지 않습니다.', 500);
    }
  }

  #withLock<T>(projectId: string, operation: () => T): T {
    const lock = join(this.#projectsRoot, `.${projectId}.lock`);
    let descriptor: number;
    try { descriptor = openSync(lock, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ThumbnailRepositoryError('PROJECT_BUSY', '다른 작업이 이 프로젝트를 저장하고 있습니다.', 409);
      }
      throw new ThumbnailRepositoryError('STORAGE_UNAVAILABLE', '프로젝트 저장소를 사용할 수 없습니다.', 500);
    }
    try { return operation(); }
    finally { closeSync(descriptor); rmSync(lock, { force: true }); }
  }

  #assertRevision(project: ThumbnailProject, expected: number): void {
    if (project.revision !== expected) {
      throw new ThumbnailRepositoryError('REVISION_CONFLICT', '다른 변경이 먼저 저장되었습니다. 프로젝트를 다시 불러오세요.', 409);
    }
  }

  #assertId(projectId: string): void {
    if (!PROJECT_ID.test(projectId)) throw new ThumbnailRepositoryError('INVALID_INPUT', '프로젝트 ID를 확인하세요.');
  }

  #assertFileName(fileName: string): void {
    if (!FILE_NAME.test(fileName) || basename(fileName) !== fileName) throw new ThumbnailRepositoryError('INVALID_INPUT', '파일 이름을 확인하세요.');
  }

  #projectDirectory(projectId: string): string {
    const directory = resolve(this.#projectsRoot, projectId);
    if (dirname(directory) !== this.#projectsRoot) throw new ThumbnailRepositoryError('INVALID_INPUT', '프로젝트 경로를 확인하세요.');
    return directory;
  }

  #relativePath(absolutePath: string): string {
    const path = relative(this.#root, absolutePath);
    if (!path || path === '..' || path.startsWith(`..${sep}`)) throw new ThumbnailRepositoryError('PATH_OUTSIDE_ROOT', '프로젝트 밖의 경로는 저장할 수 없습니다.', 500);
    return path.split(sep).join('/');
  }

  #defaultBaseTransform(canvas: { width: number; height: number }, image: { width: number; height: number }): BaseImageTransform {
    return { x: canvas.width / 2, y: canvas.height / 2, scale: Math.max(canvas.width / image.width, canvas.height / image.height), rotation: 0, blur: 0, dim: 0, brightness: 1, contrast: 1 };
  }

  #materializeTemplate(template: ThumbnailTemplate): ThumbnailTemplate {
    const result = clone(template);
    const font = this.#fonts.find(item => item.bundled);
    if (!font) return result;
    result.defaultLayers = result.defaultLayers.map(item => ({
      ...item,
      fontFamily: font.family,
      fontWeight: font.weights.reduce((best, weight) => Math.abs(weight - item.fontWeight) < Math.abs(best - item.fontWeight) ? weight : best),
    }));
    return result;
  }

  #assertLayerFonts(layers: readonly TextLayer[]): void {
    if (this.#fonts.length === 0) return;
    const genericFamilies = new Set(['sans-serif', 'serif', 'monospace', 'system-ui']);
    for (const layer of layers) {
      if (genericFamilies.has(layer.fontFamily)) continue;
      const font = this.#fonts.find(item => item.family === layer.fontFamily);
      if (!font) {
        throw new ThumbnailRepositoryError('FONT_NOT_REGISTERED', `등록되지 않은 폰트입니다: ${layer.fontFamily}`);
      }
      if (!font.weights.includes(layer.fontWeight)) {
        throw new ThumbnailRepositoryError('FONT_WEIGHT_NOT_REGISTERED', `등록되지 않은 폰트 굵기입니다: ${layer.fontFamily} ${layer.fontWeight}`);
      }
    }
  }

  #assertPrimaryAvailable(contentId: string | null): void {
    if (contentId === null) return;
    if (this.listProjects().some(project => project.contentId === contentId && project.variantOfProjectId === null)) {
      throw new ThumbnailRepositoryError('CONTENT_PRIMARY_EXISTS', '이 콘텐츠에는 이미 PRIMARY 썸네일 프로젝트가 있습니다.', 409);
    }
  }

  #assertSourceFrameUsable(project: ThumbnailProject): void {
    if (project.baseImage?.sourceFrame?.rightsReviewStatus === 'rejected') {
      throw new ThumbnailRepositoryError('SOURCE_FRAME_REJECTED', '거부된 소스 프레임은 사용할 수 없습니다.', 409);
    }
  }
}
