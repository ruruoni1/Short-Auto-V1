import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadSelectedClip, type DownloadRunner } from '../src/app/clips/download.js';
import type { SourceClip } from '../src/app/clips/models.js';
import { YouTubeClient } from '../src/app/clips/youtube.js';

const channelId = 'UC1234567890123456789012';
const uploadsPlaylistId = 'UU1234567890123456789012';
const videoA = 'video00000A';
const videoB = 'video00000B';
const oldVideo = 'video00000Z';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function channelBody(): unknown {
  return { items: [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: uploadsPlaylistId } } }] };
}

function videoItem(id: string, statistics?: Record<string, string>): unknown {
  return {
    id,
    snippet: {
      channelId,
      title: `title ${id}`,
      description: '',
      publishedAt: '2026-09-09T00:00:00Z',
      thumbnails: { high: { url: `https://img.example/${id}.jpg` } },
    },
    contentDetails: { duration: 'PT1M2S' },
    ...(statistics ? { statistics } : {}),
  };
}

test('collectChannel follows uploads pages to the successful watermark and batches details', async () => {
  const requests: URL[] = [];
  const fetchMock: typeof fetch = async input => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/channels')) return response(channelBody());
    if (url.pathname.endsWith('/playlistItems')) {
      return url.searchParams.get('pageToken') === 'next'
        ? response({ items: [{ contentDetails: { videoId: oldVideo } }] })
        : response({ items: [
          { contentDetails: { videoId: videoA } },
          { contentDetails: { videoId: videoB } },
        ], nextPageToken: 'next' });
    }
    return response({ items: [
      videoItem(videoB),
      videoItem(videoA, { viewCount: '12', likeCount: '3', commentCount: '1' }),
    ] });
  };

  const result = await new YouTubeClient('secret-key', fetchMock).collectChannel(channelId, oldVideo);
  assert.equal(result.uploadsPlaylistId, uploadsPlaylistId);
  assert.equal(result.lastSyncedVideoId, videoA);
  assert.deepEqual(result.clips.map(clip => clip.youtubeVideoId), [videoA, videoB]);
  assert.equal(result.clips[0]!.durationSeconds, 62);
  assert.deepEqual(
    [result.clips[1]!.viewCount, result.clips[1]!.likeCount, result.clips[1]!.commentCount],
    [null, null, null],
  );
  assert.equal(result.clips[0]!.youtubeChannelId, channelId);
  assert.equal(requests.filter(url => url.pathname.endsWith('/playlistItems')).length, 2);
  assert.equal(requests.find(url => url.pathname.endsWith('/playlistItems'))!.searchParams.get('maxResults'), '50');
  assert.equal(requests.find(url => url.pathname.endsWith('/videos'))!.searchParams.get('part'), 'snippet,contentDetails,statistics');
});

test('a deleted prior watermark allows a complete traversal and advances to the newest current upload', async () => {
  const fetchMock: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/channels')) return response(channelBody());
    if (url.pathname.endsWith('/playlistItems')) return response({ items: [{ contentDetails: { videoId: videoA } }] });
    return response({ items: [videoItem(videoA)] });
  };
  const result = await new YouTubeClient('key', fetchMock).collectChannel(channelId, oldVideo);
  assert.equal(result.lastSyncedVideoId, videoA);
  assert.deepEqual(result.clips.map(clip => clip.youtubeVideoId), [videoA]);
});

test('playlist page limit and unexpected video response IDs fail explicitly without exposing the key', async () => {
  let pages = 0;
  const cappedFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/channels')) return response(channelBody());
    pages += 1;
    return response({ items: [], nextPageToken: `page-${pages}` });
  };
  await assert.rejects(
    new YouTubeClient('highly-secret', cappedFetch).collectChannel(channelId, oldVideo),
    error => error instanceof Error && /200-page safety limit/.test(error.message) && !error.message.includes('highly-secret'),
  );
  assert.equal(pages, 200);

  const poisonedFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/channels')) return response(channelBody());
    if (url.pathname.endsWith('/playlistItems')) return response({ items: [{ contentDetails: { videoId: videoA } }] });
    return response({ items: [videoItem('poison00000X')] });
  };
  await assert.rejects(new YouTubeClient('key', poisonedFetch).collectChannel(channelId, null), /unexpected video ID/);
});

function clip(overrides: Partial<SourceClip> = {}): SourceClip {
  return {
    id: 'clip_1', youtubeVideoId: videoA, channelId: 'channel_1', contentType: 'anime',
    workTitle: null, episode: null, clipType: 'scene', title: 'title', description: '',
    dialogueCandidate: null, readingKo: null, meaningKo: null, contextNotes: null,
    publishedAt: '2026-09-09T00:00:00Z', durationSeconds: 62,
    viewCount: null, likeCount: null, commentCount: null,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoA}`, thumbnailUrl: null,
    subtitleAvailable: false, subtitlePath: null, localVideoPath: null, localAudioPath: null,
    sourcePriority: 'S', workTier: 'NOW', languageValueScore: null,
    sourceAvailabilityScore: null, popularityScore: null, finalScore: null,
    status: 'SELECTED', reviewedAt: '2026-09-09T01:00:00Z', reviewNotes: null,
    createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T01:00:00Z', revision: 1,
    ...overrides,
  };
}

test('downloadSelectedClip rejects anything not both reviewed and SELECTED before invoking yt-dlp', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clip-gate-'));
  let calls = 0;
  const run: DownloadRunner = async () => { calls += 1; return { exitCode: 0 }; };
  try {
    await assert.rejects(downloadSelectedClip(clip({ status: 'REVIEWED' }), { quality: 'best', subtitles: false }, { root, run }), /SELECTED status/);
    await assert.rejects(downloadSelectedClip(clip({ reviewedAt: null }), { quality: 'best', subtitles: false }, { root, run }), /completed human review/);
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('downloadSelectedClip uses shell-free bounded yt-dlp args and returns confined relative files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clip-download-'));
  const calls: Array<{ command: string; args: readonly string[]; cwd: string; shell: false }> = [];
  const run: DownloadRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, shell: options.shell });
    await writeFile(path.join(options.cwd, 'source.mp4'), 'video');
    await writeFile(path.join(options.cwd, 'source.ja.srt'), 'subtitle');
    return { exitCode: 0 };
  };
  try {
    const result = await downloadSelectedClip(clip(), { quality: '720p', subtitles: true }, { root, run });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.command, 'yt-dlp');
    assert.equal(calls[0]!.shell, false);
    assert.ok(calls[0]!.args.includes('--ignore-config'));
    assert.ok(calls[0]!.args.includes('--no-playlist'));
    assert.ok(calls[0]!.args.includes('--no-overwrites'));
    assert.ok(calls[0]!.args.includes('--restrict-filenames'));
    assert.equal(calls[0]!.args[calls[0]!.args.indexOf('--socket-timeout') + 1], '30');
    assert.equal(calls[0]!.args[calls[0]!.args.indexOf('--retries') + 1], '3');
    assert.equal(calls[0]!.args[calls[0]!.args.indexOf('--fragment-retries') + 1], '3');
    assert.ok(calls[0]!.args.includes('--write-info-json'));
    assert.ok(calls[0]!.args.includes('--clean-info-json'));
    assert.ok(calls[0]!.args.includes('srt/vtt/best'));
    assert.ok(calls[0]!.args.includes('--convert-subs'));
    assert.ok(calls[0]!.args.includes('bv*[height<=720]+ba/b[height<=720]'));
    assert.equal(calls[0]!.args.at(-1), `https://www.youtube.com/watch?v=${videoA}`);
    assert.match(result.localVideoPath, /^assets\/media\/anime\/video00000A\/[0-9a-f-]+\/source\.mp4$/);
    assert.match(result.subtitlePath!, /^assets\/media\/anime\/video00000A\/[0-9a-f-]+\/source\.ja\.srt$/);
    assert.ok(path.resolve(root, result.localVideoPath).startsWith(path.resolve(root) + path.sep));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('download failure is reported and partial job files are preserved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clip-partial-'));
  const run: DownloadRunner = async (_command, _args, options) => {
    await writeFile(path.join(options.cwd, 'source.part'), 'partial');
    return { exitCode: 2 };
  };
  try {
    await assert.rejects(downloadSelectedClip(clip(), { quality: '1080p', subtitles: false }, { root, run }), /code 2/);
    const videoDirectory = path.join(root, 'assets', 'media', 'anime', videoA);
    const jobs = await readdir(videoDirectory);
    assert.equal(jobs.length, 1);
    assert.deepEqual(await readdir(path.join(videoDirectory, jobs[0]!)), ['source.part']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
