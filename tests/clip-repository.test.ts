import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { RemoteClip } from '../src/app/clips/models.js';
import { AppError, SourceRepository } from '../src/app/clips/repository.js';

const YOUTUBE_CHANNEL_ID = `UC${'a'.repeat(22)}`;
const SECOND_CHANNEL_ID = `UC${'b'.repeat(22)}`;

function channelInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    youtubeChannelId: YOUTUBE_CHANNEL_ID,
    channelName: '공식 애니 채널',
    category: 'anime',
    sourcePriority: 'S',
    officialVerified: true,
    enabled: true,
    notes: '',
    ...overrides,
  };
}

function remoteClip(
  youtubeVideoId = 'video00000A',
  overrides: Partial<RemoteClip> = {},
): RemoteClip {
  return {
    youtubeChannelId: YOUTUBE_CHANNEL_ID,
    youtubeVideoId,
    title: `title ${youtubeVideoId}`,
    description: 'remote description',
    publishedAt: '2026-09-09T00:00:00Z',
    durationSeconds: 62,
    thumbnailUrl: `https://img.example/${youtubeVideoId}.jpg`,
    viewCount: '9007199254740993',
    likeCount: null,
    commentCount: '3',
    ...overrides,
  };
}

function expectAppError(operation: () => unknown, code: string): AppError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AppError, `Expected AppError ${code}`);
  assert.equal(caught.code, code);
  return caught;
}

test('channel writes are strict, revision-gated, and persistent', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'source-repository-'));
  const dbPath = join(root, 'sources.sqlite');
  let repository = new SourceRepository(dbPath);
  t.after(() => {
    try { repository.close(); } catch { /* already closed for reopen */ }
    rmSync(root, { recursive: true, force: true });
  });

  expectAppError(
    () => repository.createChannel({ ...channelInput(), unexpected: true }),
    'INVALID_INPUT',
  );
  const created = repository.createChannel(channelInput({ uploadsPlaylistId: '' }));
  assert.equal(created.uploadsPlaylistId, null);
  assert.equal(created.revision, 0);
  expectAppError(() => repository.createChannel(channelInput()), 'CHANNEL_EXISTS');
  expectAppError(
    () => repository.updateChannel(created.id, {
      expectedRevision: 0,
      youtubeChannelId: SECOND_CHANNEL_ID,
    }),
    'INVALID_INPUT',
  );

  const updated = repository.updateChannel(created.id, {
    expectedRevision: 0,
    channelName: '수정된 공식 채널',
    notes: '운영 메모',
  });
  assert.equal(updated.channelName, '수정된 공식 채널');
  assert.equal(updated.revision, 1);
  expectAppError(
    () => repository.updateChannel(created.id, { expectedRevision: 0, notes: 'stale' }),
    'REVISION_CONFLICT',
  );

  repository.close();
  repository = new SourceRepository(dbPath);
  assert.deepEqual(repository.listChannels(), [updated]);
  const disabled = repository.disableChannel(created.id, { expectedRevision: 1 });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.revision, 2);
});

test('remote upsert is atomic, validates ownership, and preserves review-owned data', (t) => {
  const repository = new SourceRepository(':memory:');
  t.after(() => repository.close());
  const channel = repository.createChannel(channelInput());

  const [created] = repository.upsertRemoteClips(channel.id, [remoteClip()]);
  assert.ok(created);
  assert.equal(created.status, 'NEW');
  assert.equal(created.clipType, 'other');
  assert.equal(created.workTier, 'DISCOVERY');
  assert.equal(created.subtitleAvailable, null);
  assert.equal(created.viewCount, '9007199254740993');
  assert.equal(created.youtubeUrl, 'https://www.youtube.com/watch?v=video00000A');

  const reviewed = repository.reviewClip(created.id, {
    expectedRevision: created.revision,
    decision: 'hold',
    patch: {
      workTitle: '작품명',
      episode: '12',
      clipType: 'scene',
      dialogueCandidate: 'お前は誰だ',
      readingKo: '오마에와 다레다',
      meaningKo: '너는 누구냐',
      contextNotes: '대립 장면',
      reviewNotes: '사람 검수',
    },
  });
  assert.equal(reviewed.status, 'REVIEWED');
  assert.ok(reviewed.reviewedAt);

  const [refreshed] = repository.upsertRemoteClips(channel.id, [remoteClip('video00000A', {
    title: 'updated remote title',
    description: 'updated remote description',
    viewCount: '9007199254740994',
  })]);
  assert.ok(refreshed);
  assert.equal(refreshed.id, created.id);
  assert.equal(refreshed.title, 'updated remote title');
  assert.equal(refreshed.workTitle, '작품명');
  assert.equal(refreshed.readingKo, '오마에와 다레다');
  assert.equal(refreshed.status, 'REVIEWED');
  assert.equal(refreshed.reviewedAt, reviewed.reviewedAt);
  assert.equal(refreshed.revision, reviewed.revision + 1);

  const same = repository.upsertRemoteClips(channel.id, [remoteClip('video00000A', {
    title: 'updated remote title',
    description: 'updated remote description',
    viewCount: '9007199254740994',
  })])[0]!;
  assert.equal(same.revision, refreshed.revision, 'idempotent metadata does not churn revisions');

  expectAppError(
    () => repository.upsertRemoteClips(channel.id, [
      remoteClip('video00000B'),
      remoteClip('video00000C', { youtubeChannelId: SECOND_CHANNEL_ID }),
    ]),
    'SOURCE_MISMATCH',
  );
  assert.equal(repository.listClips({ q: 'title' }).total, 1, 'failed batch rolls back earlier inserts');
  assert.equal(repository.listClips({ workTitle: '작품명', status: 'REVIEWED' }).total, 1);
  assert.deepEqual(repository.listClips({ limit: 1, offset: 1 }), { data: [], total: 1 });
});

test('review decisions enforce official-channel and human-confirmation gates', (t) => {
  const repository = new SourceRepository(':memory:');
  t.after(() => repository.close());
  let channel = repository.createChannel(channelInput());
  const [clip] = repository.upsertRemoteClips(channel.id, [remoteClip()]);
  assert.ok(clip);

  channel = repository.updateChannel(channel.id, {
    expectedRevision: channel.revision,
    officialVerified: false,
  });
  expectAppError(
    () => repository.reviewClip(clip.id, {
      expectedRevision: clip.revision,
      decision: 'select',
      humanConfirmed: true,
    }),
    'CHANNEL_NOT_OFFICIAL_ACTIVE',
  );
  channel = repository.updateChannel(channel.id, {
    expectedRevision: channel.revision,
    officialVerified: true,
  });
  expectAppError(
    () => repository.reviewClip(clip.id, {
      expectedRevision: clip.revision,
      decision: 'select',
    }),
    'HUMAN_CONFIRMATION_REQUIRED',
  );

  const selected = repository.reviewClip(clip.id, {
    expectedRevision: clip.revision,
    decision: 'select',
    humanConfirmed: true,
    patch: { contextNotes: '', reviewNotes: '확정' },
  });
  assert.equal(selected.status, 'SELECTED');
  assert.equal(selected.contextNotes, null);
  assert.ok(selected.reviewedAt);
  const saved = repository.reviewClip(clip.id, {
    expectedRevision: selected.revision,
    decision: 'save',
    patch: { meaningKo: '저장만 수정' },
  });
  assert.equal(saved.status, 'SELECTED');
  expectAppError(
    () => repository.reviewClip(clip.id, {
      expectedRevision: selected.revision,
      decision: 'reject',
    }),
    'REVISION_CONFLICT',
  );
});

test('download jobs serialize claims, lock review and channel edits, and persist file results', (t) => {
  const repository = new SourceRepository(':memory:');
  t.after(() => repository.close());
  const channel = repository.createChannel(channelInput());
  const [clip] = repository.upsertRemoteClips(channel.id, [remoteClip()]);
  assert.ok(clip);

  expectAppError(
    () => repository.claimDownload(clip.id, { quality: 'best', subtitles: true }),
    'CLIP_NOT_SELECTED',
  );
  const selected = repository.reviewClip(clip.id, {
    expectedRevision: clip.revision,
    decision: 'select',
    humanConfirmed: true,
  });
  const job = repository.claimDownload(selected.id, { quality: '1080p', subtitles: true });
  assert.equal(job.state, 'QUEUED');
  assert.equal(job.quality, '1080p');
  expectAppError(
    () => repository.claimDownload(selected.id, { quality: '720p', subtitles: false }),
    'ACTIVE_JOB_EXISTS',
  );
  expectAppError(
    () => repository.reviewClip(selected.id, {
      expectedRevision: selected.revision,
      decision: 'reject',
    }),
    'ACTIVE_JOB_CONFLICT',
  );
  expectAppError(
    () => repository.updateChannel(channel.id, {
      expectedRevision: channel.revision,
      notes: 'blocked while download is active',
    }),
    'ACTIVE_JOB_CONFLICT',
  );

  assert.equal(repository.startJob(job.id).state, 'RUNNING');
  expectAppError(
    () => repository.finishDownload(job.id, { localVideoPath: '../outside/source.mp4' }),
    'INVALID_INPUT',
  );
  expectAppError(
    () => repository.finishDownload(job.id, { localVideoPath: String.raw`C:\outside\source.mp4` }),
    'INVALID_INPUT',
  );
  assert.equal(repository.getJob(job.id).state, 'RUNNING');
  assert.equal(repository.finishDownload(job.id, {
    localVideoPath: 'assets/media/anime/video00000A/source.mp4',
    subtitlePath: 'assets/media/anime/video00000A/source.ja.srt',
    localAudioPath: 'assets/media/anime/video00000A/source.wav',
  }).state, 'SUCCEEDED');
  const downloaded = repository.getClip(selected.id);
  assert.equal(downloaded.status, 'DOWNLOADED');
  assert.equal(downloaded.subtitleAvailable, true);
  assert.equal(downloaded.localVideoPath, 'assets/media/anime/video00000A/source.mp4');
  expectAppError(
    () => repository.claimDownload(selected.id, { quality: 'best', subtitles: false }),
    'CLIP_ALREADY_DOWNLOADED',
  );
});

test('sync jobs are unique across repository connections and complete atomically', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'source-job-concurrency-'));
  const dbPath = join(root, 'sources.sqlite');
  const first = new SourceRepository(dbPath);
  const channel = first.createChannel(channelInput());
  const second = new SourceRepository(dbPath);
  t.after(() => {
    first.close();
    second.close();
    rmSync(root, { recursive: true, force: true });
  });

  const queued = first.createSyncJob(channel.id);
  expectAppError(() => second.createSyncJob(channel.id), 'ACTIVE_JOB_EXISTS');
  expectAppError(
    () => first.updateChannel(channel.id, { expectedRevision: channel.revision, notes: 'blocked' }),
    'ACTIVE_JOB_CONFLICT',
  );
  assert.equal(second.startJob(queued.id).state, 'RUNNING');
  const completed = first.completeSync(queued.id, {
    uploadsPlaylistId: `UU${'a'.repeat(22)}`,
    lastSyncedVideoId: 'video00000A',
  });
  assert.equal(completed.state, 'SUCCEEDED');
  const synced = first.listChannels()[0]!;
  assert.equal(synced.uploadsPlaylistId, `UU${'a'.repeat(22)}`);
  assert.equal(synced.lastSyncedVideoId, 'video00000A');
  assert.ok(synced.lastSyncedAt);
  assert.equal(synced.revision, channel.revision + 1);

  const interrupted = second.createSyncJob(channel.id);
  first.startJob(interrupted.id);
  assert.equal(second.recoverInterruptedJobs(), 1);
  const recovered = first.getJob(interrupted.id);
  assert.equal(recovered.state, 'FAILED');
  assert.equal(recovered.errorCode, 'INTERRUPTED');
  assert.equal(first.createSyncJob(channel.id).state, 'QUEUED', 'recovery releases active uniqueness');
});

test('failed jobs retain structured errors and release their active slot', (t) => {
  const repository = new SourceRepository(':memory:');
  t.after(() => repository.close());
  const channel = repository.createChannel(channelInput());
  const job = repository.createSyncJob(channel.id);
  expectAppError(
    () => repository.failJob(job.id, { code: 'NETWORK', message: 'failed', unexpected: true }),
    'INVALID_INPUT',
  );
  const failed = repository.failJob(job.id, { code: 'NETWORK', message: 'quota unavailable' });
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.errorCode, 'NETWORK');
  assert.equal(failed.errorMessage, 'quota unavailable');
  assert.equal(repository.createSyncJob(channel.id).state, 'QUEUED');
  expectAppError(
    () => repository.failJob(job.id, { code: 'AGAIN', message: 'invalid transition' }),
    'JOB_STATE',
  );
});

test('a restarted worker revalidates persisted download gates and recovers interruption', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'source-download-restart-'));
  const dbPath = join(root, 'sources.sqlite');
  let repository = new SourceRepository(dbPath);
  t.after(() => {
    try { repository.close(); } catch { /* already closed for restart */ }
    rmSync(root, { recursive: true, force: true });
  });
  const channel = repository.createChannel(channelInput());
  const clip = repository.upsertRemoteClips(channel.id, [remoteClip()])[0]!;
  const selected = repository.reviewClip(clip.id, {
    expectedRevision: clip.revision,
    decision: 'select',
    humanConfirmed: true,
  });
  const job = repository.claimDownload(selected.id, { quality: 'best', subtitles: false });
  repository.close();

  let raw = new DatabaseSync(dbPath);
  raw.prepare("UPDATE source_clips SET status = 'REJECTED' WHERE id = ?").run(selected.id);
  raw.close();
  repository = new SourceRepository(dbPath);
  expectAppError(() => repository.startJob(job.id), 'CLIP_NOT_SELECTED');
  assert.equal(repository.getJob(job.id).state, 'QUEUED');

  raw = new DatabaseSync(dbPath);
  raw.prepare("UPDATE source_clips SET status = 'SELECTED' WHERE id = ?").run(selected.id);
  raw.close();
  repository.startJob(job.id);
  raw = new DatabaseSync(dbPath);
  raw.prepare('UPDATE source_channels SET official_verified = 0 WHERE id = ?').run(channel.id);
  raw.close();
  expectAppError(
    () => repository.finishDownload(job.id, { localVideoPath: 'assets/media/source.mp4' }),
    'CHANNEL_NOT_OFFICIAL_ACTIVE',
  );
  assert.equal(repository.getJob(job.id).state, 'RUNNING');

  repository.close();
  repository = new SourceRepository(dbPath);
  assert.equal(repository.recoverInterruptedJobs(), 1);
  assert.equal(repository.getJob(job.id).state, 'FAILED');
  assert.equal(repository.getJob(job.id).errorCode, 'INTERRUPTED');
});
