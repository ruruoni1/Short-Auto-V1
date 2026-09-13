import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ZodType } from 'zod';
import {
  CompleteSyncInputSchema,
  CreateChannelInputSchema,
  DisableChannelInputSchema,
  DownloadOptionsSchema,
  FailJobInputSchema,
  FinishDownloadInputSchema,
  ListClipsQuerySchema,
  RemoteClipListSchema,
  RepositoryJobSchema,
  ReviewClipInputSchema,
  SourceChannelSchema,
  SourceClipSchema,
  UpdateChannelInputSchema,
  type RepositoryJob,
  type SourceChannel,
  type SourceClip,
} from './models.js';

type SqlValue = string | number | null;
type Row = Record<string, unknown>;

const CHANNEL_COLUMNS = `
  id,
  youtube_channel_id AS youtubeChannelId,
  channel_name AS channelName,
  category,
  source_priority AS sourcePriority,
  official_verified AS officialVerified,
  enabled,
  notes,
  uploads_playlist_id AS uploadsPlaylistId,
  last_synced_at AS lastSyncedAt,
  last_synced_video_id AS lastSyncedVideoId,
  revision
`;

const CLIP_COLUMNS = `
  id,
  youtube_video_id AS youtubeVideoId,
  channel_id AS channelId,
  content_type AS contentType,
  work_title AS workTitle,
  episode,
  clip_type AS clipType,
  title,
  description,
  dialogue_candidate AS dialogueCandidate,
  reading_ko AS readingKo,
  meaning_ko AS meaningKo,
  context_notes AS contextNotes,
  published_at AS publishedAt,
  duration_seconds AS durationSeconds,
  view_count AS viewCount,
  like_count AS likeCount,
  comment_count AS commentCount,
  youtube_url AS youtubeUrl,
  thumbnail_url AS thumbnailUrl,
  subtitle_available AS subtitleAvailable,
  subtitle_path AS subtitlePath,
  local_video_path AS localVideoPath,
  local_audio_path AS localAudioPath,
  source_priority AS sourcePriority,
  work_tier AS workTier,
  language_value_score AS languageValueScore,
  source_availability_score AS sourceAvailabilityScore,
  popularity_score AS popularityScore,
  final_score AS finalScore,
  status,
  reviewed_at AS reviewedAt,
  review_notes AS reviewNotes,
  created_at AS createdAt,
  updated_at AS updatedAt,
  revision
`;

const JOB_COLUMNS = `
  id,
  kind,
  state,
  channel_id AS channelId,
  clip_id AS clipId,
  quality,
  subtitles,
  error_code AS errorCode,
  error_message AS errorMessage,
  created_at AS createdAt,
  started_at AS startedAt,
  finished_at AS finishedAt
`;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw new AppError('INVALID_INPUT', `${path}${issue?.message ?? 'Invalid input'}`);
}

function now(): string {
  return new Date().toISOString();
}

function bool(value: unknown): boolean {
  return value === 1;
}

function channelFromRow(row: Row): SourceChannel {
  return SourceChannelSchema.parse({
    ...row,
    officialVerified: bool(row.officialVerified),
    enabled: bool(row.enabled),
  });
}

function clipFromRow(row: Row): SourceClip {
  return SourceClipSchema.parse({
    ...row,
    subtitleAvailable: row.subtitleAvailable === null ? null : bool(row.subtitleAvailable),
  });
}

function jobFromRow(row: Row): RepositoryJob {
  return RepositoryJobSchema.parse({
    ...row,
    subtitles: row.subtitles === null ? null : bool(row.subtitles),
  });
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint failed|unique constraint/i.test(error.message);
}

/** Persistent Official Clip Library repository backed by Node's synchronous SQLite API. */
export class SourceRepository {
  readonly #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS source_channels (
        id TEXT PRIMARY KEY,
        youtube_channel_id TEXT NOT NULL UNIQUE,
        channel_name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('anime', 'drama')),
        source_priority TEXT NOT NULL CHECK (source_priority IN ('S', 'A', 'B')),
        official_verified INTEGER NOT NULL CHECK (official_verified IN (0, 1)),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        notes TEXT NOT NULL,
        uploads_playlist_id TEXT,
        last_synced_at TEXT,
        last_synced_video_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      );

      CREATE TABLE IF NOT EXISTS source_clips (
        id TEXT PRIMARY KEY,
        youtube_video_id TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL REFERENCES source_channels(id),
        content_type TEXT NOT NULL CHECK (content_type IN ('anime', 'drama')),
        work_title TEXT,
        episode TEXT,
        clip_type TEXT NOT NULL CHECK (clip_type IN ('scene', 'highlight', 'short', 'cutout', 'digest', 'preview', 'pv', 'other')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        dialogue_candidate TEXT,
        reading_ko TEXT,
        meaning_ko TEXT,
        context_notes TEXT,
        published_at TEXT NOT NULL,
        duration_seconds INTEGER,
        view_count TEXT,
        like_count TEXT,
        comment_count TEXT,
        youtube_url TEXT NOT NULL,
        thumbnail_url TEXT,
        subtitle_available INTEGER CHECK (subtitle_available IS NULL OR subtitle_available IN (0, 1)),
        subtitle_path TEXT,
        local_video_path TEXT,
        local_audio_path TEXT,
        source_priority TEXT NOT NULL CHECK (source_priority IN ('S', 'A', 'B')),
        work_tier TEXT NOT NULL CHECK (work_tier IN ('NOW', 'EVERGREEN', 'DISCOVERY')),
        language_value_score REAL,
        source_availability_score REAL,
        popularity_score REAL,
        final_score REAL,
        status TEXT NOT NULL CHECK (status IN ('NEW', 'ANALYZED', 'REVIEWED', 'CANDIDATE', 'SELECTED', 'DOWNLOADED', 'REJECTED')),
        reviewed_at TEXT,
        review_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      );

      CREATE INDEX IF NOT EXISTS ix_source_clips_channel ON source_clips(channel_id);
      CREATE INDEX IF NOT EXISTS ix_source_clips_status ON source_clips(status);
      CREATE INDEX IF NOT EXISTS ix_source_clips_published ON source_clips(published_at DESC);

      CREATE TABLE IF NOT EXISTS repository_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('sync', 'download')),
        state TEXT NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
        channel_id TEXT REFERENCES source_channels(id),
        clip_id TEXT REFERENCES source_clips(id),
        quality TEXT CHECK (quality IS NULL OR quality IN ('best', '1080p', '720p')),
        subtitles INTEGER CHECK (subtitles IS NULL OR subtitles IN (0, 1)),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        CHECK ((kind = 'sync' AND channel_id IS NOT NULL AND clip_id IS NULL AND quality IS NULL AND subtitles IS NULL)
          OR (kind = 'download' AND channel_id IS NULL AND clip_id IS NOT NULL AND quality IS NOT NULL AND subtitles IS NOT NULL))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ux_repository_jobs_active_sync
        ON repository_jobs(channel_id)
        WHERE kind = 'sync' AND state IN ('QUEUED', 'RUNNING');
      CREATE UNIQUE INDEX IF NOT EXISTS ux_repository_jobs_active_download
        ON repository_jobs(clip_id)
        WHERE kind = 'download' AND state IN ('QUEUED', 'RUNNING');
    `);
  }

  close(): void {
    this.#db.close();
  }

  listChannels(): SourceChannel[] {
    const rows = this.#db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM source_channels ORDER BY channel_name, id`).all() as Row[];
    return rows.map(channelFromRow);
  }

  createChannel(input: unknown): SourceChannel {
    const parsed = parseInput(CreateChannelInputSchema, input);
    const id = randomUUID();
    try {
      this.#db.prepare(`
        INSERT INTO source_channels (
          id, youtube_channel_id, channel_name, category, source_priority,
          official_verified, enabled, notes, uploads_playlist_id, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        id,
        parsed.youtubeChannelId,
        parsed.channelName,
        parsed.category,
        parsed.sourcePriority,
        parsed.officialVerified ? 1 : 0,
        parsed.enabled ? 1 : 0,
        parsed.notes,
        parsed.uploadsPlaylistId,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new AppError('CHANNEL_EXISTS', 'A channel with this YouTube channel ID already exists', 409);
      }
      throw error;
    }
    return this.#getChannel(id);
  }

  updateChannel(id: string, input: unknown): SourceChannel {
    const parsed = parseInput(UpdateChannelInputSchema, input);
    return this.#transaction(() => {
      const current = this.#getChannel(id);
      this.#assertRevision(current.revision, parsed.expectedRevision);
      this.#assertChannelIdle(id);

      const columns: string[] = [];
      const values: SqlValue[] = [];
      const mapping = {
        channelName: 'channel_name',
        category: 'category',
        sourcePriority: 'source_priority',
        officialVerified: 'official_verified',
        enabled: 'enabled',
        notes: 'notes',
        uploadsPlaylistId: 'uploads_playlist_id',
      } as const;
      for (const [key, column] of Object.entries(mapping)) {
        const value = parsed[key as keyof typeof mapping];
        if (value === undefined) continue;
        columns.push(`${column} = ?`);
        values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
      values.push(id, parsed.expectedRevision);
      this.#db.prepare(`
        UPDATE source_channels
        SET ${columns.join(', ')}, revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(...values);
      return this.#getChannel(id);
    });
  }

  disableChannel(id: string, input: unknown): SourceChannel {
    const parsed = parseInput(DisableChannelInputSchema, input);
    return this.#transaction(() => {
      const current = this.#getChannel(id);
      this.#assertRevision(current.revision, parsed.expectedRevision);
      this.#assertChannelIdle(id);
      this.#db.prepare(`
        UPDATE source_channels
        SET enabled = 0, revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(id, parsed.expectedRevision);
      return this.#getChannel(id);
    });
  }

  listClips(query: unknown = {}): { data: SourceClip[]; total: number } {
    const parsed = parseInput(ListClipsQuerySchema, query);
    const conditions: string[] = [];
    const values: SqlValue[] = [];
    if (parsed.q !== undefined) {
      conditions.push(`(title LIKE ? OR description LIKE ? OR COALESCE(work_title, '') LIKE ? OR COALESCE(episode, '') LIKE ?
        OR COALESCE(dialogue_candidate, '') LIKE ? OR COALESCE(reading_ko, '') LIKE ?
        OR COALESCE(meaning_ko, '') LIKE ? OR COALESCE(context_notes, '') LIKE ?)`);
      const q = `%${parsed.q}%`;
      values.push(q, q, q, q, q, q, q, q);
    }
    const filters = {
      channelId: 'channel_id',
      contentType: 'content_type',
      clipType: 'clip_type',
      status: 'status',
      workTier: 'work_tier',
      workTitle: 'work_title',
    } as const;
    for (const [key, column] of Object.entries(filters)) {
      const value = parsed[key as keyof typeof filters];
      if (value === undefined) continue;
      conditions.push(`${column} = ?`);
      values.push(value);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = this.#db.prepare(`SELECT COUNT(*) AS total FROM source_clips ${where}`).get(...values) as Row;
    const rows = this.#db.prepare(`
      SELECT ${CLIP_COLUMNS}
      FROM source_clips
      ${where}
      ORDER BY published_at DESC, id
      LIMIT ? OFFSET ?
    `).all(...values, parsed.limit, parsed.offset) as Row[];
    return { data: rows.map(clipFromRow), total: Number(totalRow.total) };
  }

  getClip(id: string): SourceClip {
    return this.#getClip(id);
  }

  upsertRemoteClips(channelId: string, clips: unknown): SourceClip[] {
    const parsed = parseInput(RemoteClipListSchema, clips);
    return this.#transaction(() => {
      const channel = this.#getChannel(channelId);
      this.#assertOfficialActive(channel);
      const results: SourceClip[] = [];
      for (const remote of parsed) {
        if (remote.youtubeChannelId !== channel.youtubeChannelId) {
          throw new AppError('SOURCE_MISMATCH', 'Remote clip does not belong to the requested source channel', 409);
        }
        const existingRow = this.#db.prepare(`SELECT ${CLIP_COLUMNS} FROM source_clips WHERE youtube_video_id = ?`).get(remote.youtubeVideoId) as Row | undefined;
        if (existingRow) {
          const existing = clipFromRow(existingRow);
          if (existing.channelId !== channelId) {
            throw new AppError('SOURCE_MISMATCH', 'YouTube video is already owned by another source channel', 409);
          }
          const changed = existing.title !== remote.title
            || existing.description !== remote.description
            || existing.publishedAt !== remote.publishedAt
            || existing.durationSeconds !== remote.durationSeconds
            || existing.thumbnailUrl !== remote.thumbnailUrl
            || existing.viewCount !== remote.viewCount
            || existing.likeCount !== remote.likeCount
            || existing.commentCount !== remote.commentCount;
          if (changed) {
            this.#db.prepare(`
              UPDATE source_clips SET
                title = ?, description = ?, published_at = ?, duration_seconds = ?, thumbnail_url = ?,
                view_count = ?, like_count = ?, comment_count = ?, updated_at = ?, revision = revision + 1
              WHERE id = ?
            `).run(
              remote.title,
              remote.description,
              remote.publishedAt,
              remote.durationSeconds,
              remote.thumbnailUrl,
              remote.viewCount,
              remote.likeCount,
              remote.commentCount,
              now(),
              existing.id,
            );
          }
          results.push(this.#getClip(existing.id));
          continue;
        }

        const id = randomUUID();
        const timestamp = now();
        this.#db.prepare(`
          INSERT INTO source_clips (
            id, youtube_video_id, channel_id, content_type, work_title, episode, clip_type,
            title, description, dialogue_candidate, reading_ko, meaning_ko, context_notes,
            published_at, duration_seconds, view_count, like_count, comment_count, youtube_url,
            thumbnail_url, subtitle_available, subtitle_path, local_video_path, local_audio_path,
            source_priority, work_tier, language_value_score, source_availability_score,
            popularity_score, final_score, status, reviewed_at, review_notes,
            created_at, updated_at, revision
          ) VALUES (
            ?, ?, ?, ?, NULL, NULL, 'other', ?, ?, NULL, NULL, NULL, NULL,
            ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'DISCOVERY',
            NULL, NULL, NULL, NULL, 'NEW', NULL, NULL, ?, ?, 0
          )
        `).run(
          id,
          remote.youtubeVideoId,
          channelId,
          channel.category,
          remote.title,
          remote.description,
          remote.publishedAt,
          remote.durationSeconds,
          remote.viewCount,
          remote.likeCount,
          remote.commentCount,
          `https://www.youtube.com/watch?v=${remote.youtubeVideoId}`,
          remote.thumbnailUrl,
          channel.sourcePriority,
          timestamp,
          timestamp,
        );
        results.push(this.#getClip(id));
      }
      return results;
    });
  }

  reviewClip(id: string, input: unknown): SourceClip {
    const parsed = parseInput(ReviewClipInputSchema, input);
    return this.#transaction(() => {
      const current = this.#getClip(id);
      this.#assertRevision(current.revision, parsed.expectedRevision);
      this.#assertClipIdle(id);

      if (parsed.decision === 'select') {
        if (parsed.humanConfirmed !== true) {
          throw new AppError('HUMAN_CONFIRMATION_REQUIRED', 'Selecting a clip requires explicit human confirmation');
        }
        this.#assertOfficialActive(this.#getChannel(current.channelId));
      }

      const status = parsed.decision === 'save'
        ? current.status
        : parsed.decision === 'hold'
          ? 'REVIEWED'
          : parsed.decision === 'select'
            ? 'SELECTED'
            : 'REJECTED';
      const columns: string[] = [];
      const values: SqlValue[] = [];
      const mapping = {
        workTitle: 'work_title',
        episode: 'episode',
        clipType: 'clip_type',
        dialogueCandidate: 'dialogue_candidate',
        readingKo: 'reading_ko',
        meaningKo: 'meaning_ko',
        contextNotes: 'context_notes',
        workTier: 'work_tier',
        languageValueScore: 'language_value_score',
        sourceAvailabilityScore: 'source_availability_score',
        popularityScore: 'popularity_score',
        finalScore: 'final_score',
        reviewNotes: 'review_notes',
      } as const;
      for (const [key, column] of Object.entries(mapping)) {
        const value = parsed.patch?.[key as keyof typeof mapping];
        if (value === undefined) continue;
        columns.push(`${column} = ?`);
        values.push(value);
      }
      columns.push('status = ?', 'updated_at = ?', 'revision = revision + 1');
      values.push(status, now());
      if (parsed.decision !== 'save') {
        columns.push('reviewed_at = ?');
        values.push(now());
      }
      values.push(id, parsed.expectedRevision);
      this.#db.prepare(`
        UPDATE source_clips SET ${columns.join(', ')}
        WHERE id = ? AND revision = ?
      `).run(...values);
      return this.#getClip(id);
    });
  }

  createSyncJob(channelId: string): RepositoryJob {
    return this.#transaction(() => {
      this.#assertOfficialActive(this.#getChannel(channelId));
      const id = randomUUID();
      try {
        this.#db.prepare(`
          INSERT INTO repository_jobs (id, kind, state, channel_id, clip_id, quality, subtitles, created_at)
          VALUES (?, 'sync', 'QUEUED', ?, NULL, NULL, NULL, ?)
        `).run(id, channelId, now());
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('ACTIVE_JOB_EXISTS', 'This channel already has an active sync job', 409);
        }
        throw error;
      }
      return this.#getJob(id);
    });
  }

  claimDownload(clipId: string, options: unknown): RepositoryJob {
    const parsed = parseInput(DownloadOptionsSchema, options);
    return this.#transaction(() => {
      const clip = this.#getClip(clipId);
      if (clip.status === 'DOWNLOADED' || clip.localVideoPath !== null) {
        throw new AppError('CLIP_ALREADY_DOWNLOADED', 'This clip already has downloaded media', 409);
      }
      if (clip.status !== 'SELECTED' || clip.reviewedAt === null) {
        throw new AppError('CLIP_NOT_SELECTED', 'Only a human-reviewed SELECTED clip can be downloaded', 409);
      }
      this.#assertOfficialActive(this.#getChannel(clip.channelId));
      const id = randomUUID();
      try {
        this.#db.prepare(`
          INSERT INTO repository_jobs (id, kind, state, channel_id, clip_id, quality, subtitles, created_at)
          VALUES (?, 'download', 'QUEUED', NULL, ?, ?, ?, ?)
        `).run(id, clipId, parsed.quality, parsed.subtitles ? 1 : 0, now());
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('ACTIVE_JOB_EXISTS', 'This clip already has an active download job', 409);
        }
        throw error;
      }
      return this.#getJob(id);
    });
  }

  getJob(id: string): RepositoryJob {
    return this.#getJob(id);
  }

  startJob(id: string): RepositoryJob {
    return this.#transaction(() => {
      const job = this.#getJob(id);
      this.#assertJobState(job, 'QUEUED');
      if (job.kind === 'download') this.#assertDownloadStillAllowed(job);
      this.#db.prepare(`
        UPDATE repository_jobs SET state = 'RUNNING', started_at = ? WHERE id = ? AND state = 'QUEUED'
      `).run(now(), id);
      return this.#getJob(id);
    });
  }

  completeSync(jobId: string, input: unknown): RepositoryJob {
    const parsed = parseInput(CompleteSyncInputSchema, input);
    return this.#transaction(() => {
      const job = this.#getJob(jobId);
      this.#assertJobKind(job, 'sync');
      this.#assertJobState(job, 'RUNNING');
      if (job.channelId === null) throw new AppError('CORRUPT_JOB', 'Sync job has no channel', 500);
      const timestamp = now();
      this.#db.prepare(`
        UPDATE source_channels SET
          uploads_playlist_id = ?, last_synced_video_id = ?, last_synced_at = ?, revision = revision + 1
        WHERE id = ?
      `).run(parsed.uploadsPlaylistId, parsed.lastSyncedVideoId, timestamp, job.channelId);
      this.#db.prepare(`
        UPDATE repository_jobs SET state = 'SUCCEEDED', finished_at = ? WHERE id = ? AND state = 'RUNNING'
      `).run(timestamp, jobId);
      return this.#getJob(jobId);
    });
  }

  finishDownload(jobId: string, input: unknown): RepositoryJob {
    const parsed = parseInput(FinishDownloadInputSchema, input);
    return this.#transaction(() => {
      const job = this.#getJob(jobId);
      this.#assertJobKind(job, 'download');
      this.#assertJobState(job, 'RUNNING');
      this.#assertDownloadStillAllowed(job);
      const timestamp = now();
      const subtitleAvailable = parsed.subtitlePath !== undefined ? 1 : job.subtitles ? 0 : null;
      this.#db.prepare(`
        UPDATE source_clips SET
          local_video_path = ?, subtitle_path = ?, local_audio_path = ?, subtitle_available = ?,
          status = 'DOWNLOADED', updated_at = ?, revision = revision + 1
        WHERE id = ?
      `).run(
        parsed.localVideoPath,
        parsed.subtitlePath ?? null,
        parsed.localAudioPath ?? null,
        subtitleAvailable,
        timestamp,
        job.clipId,
      );
      this.#db.prepare(`
        UPDATE repository_jobs SET state = 'SUCCEEDED', finished_at = ? WHERE id = ? AND state = 'RUNNING'
      `).run(timestamp, jobId);
      return this.#getJob(jobId);
    });
  }

  failJob(jobId: string, input: unknown): RepositoryJob {
    const parsed = parseInput(FailJobInputSchema, input);
    return this.#transaction(() => {
      const job = this.#getJob(jobId);
      if (job.state !== 'QUEUED' && job.state !== 'RUNNING') {
        throw new AppError('JOB_STATE', `Job must be active, but is ${job.state}`, 409);
      }
      this.#db.prepare(`
        UPDATE repository_jobs SET state = 'FAILED', error_code = ?, error_message = ?, finished_at = ?
        WHERE id = ? AND state IN ('QUEUED', 'RUNNING')
      `).run(parsed.code, parsed.message, now(), jobId);
      return this.#getJob(jobId);
    });
  }

  recoverInterruptedJobs(): number {
    return this.#transaction(() => {
      const result = this.#db.prepare(`
        UPDATE repository_jobs SET
          state = 'FAILED', error_code = 'INTERRUPTED',
          error_message = 'Job was interrupted before repository startup recovery', finished_at = ?
        WHERE state = 'RUNNING'
      `).run(now());
      return Number(result.changes);
    });
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #getChannel(id: string): SourceChannel {
    const row = this.#db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM source_channels WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new AppError('CHANNEL_NOT_FOUND', `Source channel not found: ${id}`, 404);
    return channelFromRow(row);
  }

  #getClip(id: string): SourceClip {
    const row = this.#db.prepare(`SELECT ${CLIP_COLUMNS} FROM source_clips WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new AppError('CLIP_NOT_FOUND', `Source clip not found: ${id}`, 404);
    return clipFromRow(row);
  }

  #getJob(id: string): RepositoryJob {
    const row = this.#db.prepare(`SELECT ${JOB_COLUMNS} FROM repository_jobs WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new AppError('JOB_NOT_FOUND', `Repository job not found: ${id}`, 404);
    return jobFromRow(row);
  }

  #assertRevision(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new AppError('REVISION_CONFLICT', `Expected revision ${expected}, but current revision is ${actual}`, 409);
    }
  }

  #assertOfficialActive(channel: SourceChannel): void {
    if (!channel.officialVerified || !channel.enabled) {
      throw new AppError('CHANNEL_NOT_OFFICIAL_ACTIVE', 'Source channel must be official, verified, and enabled', 409);
    }
  }

  #assertClipIdle(clipId: string): void {
    const row = this.#db.prepare(`
      SELECT id FROM repository_jobs
      WHERE kind = 'download' AND clip_id = ? AND state IN ('QUEUED', 'RUNNING')
    `).get(clipId);
    if (row) throw new AppError('ACTIVE_JOB_CONFLICT', 'Clip has an active download job', 409);
  }

  #assertChannelIdle(channelId: string): void {
    const row = this.#db.prepare(`
      SELECT j.id
      FROM repository_jobs j
      LEFT JOIN source_clips c ON c.id = j.clip_id
      WHERE j.state IN ('QUEUED', 'RUNNING')
        AND ((j.kind = 'sync' AND j.channel_id = ?) OR (j.kind = 'download' AND c.channel_id = ?))
      LIMIT 1
    `).get(channelId, channelId);
    if (row) throw new AppError('ACTIVE_JOB_CONFLICT', 'Channel has an active repository job', 409);
  }

  #assertJobKind(job: RepositoryJob, expected: RepositoryJob['kind']): void {
    if (job.kind !== expected) {
      throw new AppError('JOB_KIND', `Expected a ${expected} job, but found ${job.kind}`, 409);
    }
  }

  #assertJobState(job: RepositoryJob, expected: RepositoryJob['state']): void {
    if (job.state !== expected) {
      throw new AppError('JOB_STATE', `Expected job state ${expected}, but found ${job.state}`, 409);
    }
  }

  #assertDownloadStillAllowed(job: RepositoryJob): SourceClip {
    if (job.clipId === null) throw new AppError('CORRUPT_JOB', 'Download job has no clip', 500);
    const clip = this.#getClip(job.clipId);
    if (clip.status === 'DOWNLOADED' || clip.localVideoPath !== null) {
      throw new AppError('CLIP_ALREADY_DOWNLOADED', 'This clip already has downloaded media', 409);
    }
    if (clip.status !== 'SELECTED' || clip.reviewedAt === null) {
      throw new AppError('CLIP_NOT_SELECTED', 'Only a human-reviewed SELECTED clip can be downloaded', 409);
    }
    this.#assertOfficialActive(this.#getChannel(clip.channelId));
    return clip;
  }
}
