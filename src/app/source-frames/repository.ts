import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SourceRepository } from '../clips/repository.js';
import {
  ListSourceFramesQuerySchema,
  SourceFrameSchema,
  type ListSourceFramesQuery,
  type SourceFrame,
} from './models.js';

type Row = Record<string, unknown>;

const COLUMNS = `
  id,
  source_clip_id AS sourceClipId,
  source_channel_id AS sourceChannelId,
  youtube_video_id AS youtubeVideoId,
  timestamp_ms AS timestampMs,
  local_path AS localPath,
  format,
  mime_type AS mimeType,
  width,
  height,
  byte_length AS byteLength,
  sha256,
  candidate_type AS candidateType,
  rights_review_status AS rightsReviewStatus,
  rights_review_notes AS rightsReviewNotes,
  work_title AS workTitle,
  episode,
  source_url AS sourceUrl,
  created_at AS createdAt
`;

export class SourceFrameError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'SourceFrameError';
    this.code = code;
    this.status = status;
  }
}

export interface InsertSourceFrame {
  id?: string;
  sourceClipId: string;
  sourceChannelId: string;
  youtubeVideoId: string;
  timestampMs: number;
  localPath: string;
  format: 'jpeg' | 'png';
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  candidateType: 'thumbnail' | 'reference' | 'storyboard';
  rightsReviewStatus: 'unchecked';
  rightsReviewNotes: string;
  workTitle: string | null;
  episode: string | null;
  sourceUrl: string;
  createdAt?: string;
}

export interface InsertSourceFrameResult {
  frame: SourceFrame;
  created: boolean;
}

export class SourceFrameRepository {
  readonly #db: DatabaseSync;
  readonly #clips: Pick<SourceRepository, 'getClip'>;

  constructor(dbPath: string, clips: Pick<SourceRepository, 'getClip'>) {
    this.#clips = clips;
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS source_frames (
        id TEXT PRIMARY KEY,
        source_clip_id TEXT NOT NULL,
        source_channel_id TEXT NOT NULL,
        youtube_video_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
        local_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL CHECK (format IN ('jpeg', 'png')),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
        width INTEGER NOT NULL CHECK (width > 0),
        height INTEGER NOT NULL CHECK (height > 0),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        sha256 TEXT NOT NULL,
        candidate_type TEXT NOT NULL CHECK (candidate_type IN ('thumbnail', 'reference', 'storyboard')),
        rights_review_status TEXT NOT NULL CHECK (rights_review_status IN ('unchecked', 'reviewed', 'rejected')),
        rights_review_notes TEXT NOT NULL,
        work_title TEXT,
        episode TEXT,
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (source_clip_id, timestamp_ms)
      );
      CREATE INDEX IF NOT EXISTS ix_source_frames_clip_time ON source_frames(source_clip_id, timestamp_ms);
    `);
  }

  close(): void {
    this.#db.close();
  }

  listFrames(query: unknown = {}): SourceFrame[] {
    const parsed: ListSourceFramesQuery = ListSourceFramesQuerySchema.parse(query);
    if (parsed.clipId) this.#clips.getClip(parsed.clipId);
    const rows = parsed.clipId
      ? this.#db.prepare(`SELECT ${COLUMNS} FROM source_frames WHERE source_clip_id = ? ORDER BY timestamp_ms, id`).all(parsed.clipId) as Row[]
      : this.#db.prepare(`SELECT ${COLUMNS} FROM source_frames ORDER BY created_at DESC, id`).all() as Row[];
    return rows.map(row => this.#parseStored(row));
  }

  getFrame(id: string): SourceFrame {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new SourceFrameError('INVALID_INPUT', '프레임 ID를 확인하세요.');
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM source_frames WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new SourceFrameError('SOURCE_FRAME_NOT_FOUND', '소스 프레임을 찾을 수 없습니다.', 404);
    return this.#parseStored(row);
  }

  findByClipTimestamp(sourceClipId: string, timestampMs: number): SourceFrame | null {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM source_frames WHERE source_clip_id = ? AND timestamp_ms = ?`).get(sourceClipId, timestampMs) as Row | undefined;
    return row ? this.#parseStored(row) : null;
  }

  insertFrame(input: InsertSourceFrame): InsertSourceFrameResult {
    const id = input.id ?? randomUUID();
    const frame = SourceFrameSchema.parse({ ...input, id, createdAt: input.createdAt ?? new Date().toISOString() });
    this.#validateIdentity(frame);
    try {
      this.#db.prepare(`
        INSERT INTO source_frames (
          id, source_clip_id, source_channel_id, youtube_video_id, timestamp_ms, local_path,
          format, mime_type, width, height, byte_length, sha256, candidate_type,
          rights_review_status, rights_review_notes, work_title, episode, source_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        frame.id, frame.sourceClipId, frame.sourceChannelId, frame.youtubeVideoId, frame.timestampMs, frame.localPath,
        frame.format, frame.mimeType, frame.width, frame.height, frame.byteLength, frame.sha256, frame.candidateType,
        frame.rightsReviewStatus, frame.rightsReviewNotes, frame.workTitle, frame.episode, frame.sourceUrl, frame.createdAt,
      );
      return { frame: this.getFrame(frame.id), created: true };
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        const existing = this.findByClipTimestamp(frame.sourceClipId, frame.timestampMs);
        if (existing) return { frame: existing, created: false };
        throw new SourceFrameError('SOURCE_FRAME_CONFLICT', '소스 프레임 저장이 충돌했습니다.', 409);
      }
      throw error;
    }
  }

  #validateIdentity(frame: SourceFrame): SourceFrame {
    try {
      const clip = this.#clips.getClip(frame.sourceClipId);
      const extension = frame.format === 'jpeg' ? 'jpg' : 'png';
      const expectedPath = `assets/frames/${frame.sourceClipId}/${frame.id}.${extension}`;
      if (clip.channelId !== frame.sourceChannelId || clip.youtubeVideoId !== frame.youtubeVideoId
        || clip.youtubeUrl !== frame.sourceUrl || clip.workTitle !== frame.workTitle || clip.episode !== frame.episode
        || frame.localPath !== expectedPath) {
        throw new Error('identity mismatch');
      }
      return frame;
    } catch (error) {
      if (error instanceof SourceFrameError) throw error;
      throw new SourceFrameError('SOURCE_FRAME_CORRUPT', '저장된 소스 프레임의 원본 연결이 올바르지 않습니다.', 500);
    }
  }

  #parseStored(row: Row): SourceFrame {
    try { return this.#validateIdentity(SourceFrameSchema.parse(row)); }
    catch (error) {
      if (error instanceof SourceFrameError && error.code === 'SOURCE_FRAME_CORRUPT') throw error;
      throw new SourceFrameError('SOURCE_FRAME_CORRUPT', '저장된 소스 프레임 데이터가 올바르지 않습니다.', 500);
    }
  }
}
