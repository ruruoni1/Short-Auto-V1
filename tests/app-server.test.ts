import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceRepository } from '../src/app/clips/repository.js';
import { createAppServer } from '../src/app/server.js';
import { APP_PATHS } from '../src/app/config.js';
import { YouTubeClient } from '../src/app/clips/youtube.js';
import { request as httpRequest } from 'node:http';

test('local API preserves review gates and rejects foreign origins and stale edits', async (t) => {
  const repository = new SourceRepository(':memory:');
  const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube: null,
    download: async () => { throw new Error('simulated unavailable downloader'); },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); repository.close(); });
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, method = 'GET', data?: unknown, headers = {}) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert.equal((await request('/api/health')).status, 200);
  const channelData = { youtubeChannelId: 'UC' + 'a'.repeat(22), channelName: '検証用', category: 'anime', sourcePriority: 'S', officialVerified: true, enabled: true, notes: '' };
  assert.equal((await request('/api/channels','POST',channelData,{Origin:'https://foreign.example'})).status,403);
  const created = await request('/api/channels','POST',channelData);
  assert.equal(created.status,201);
  const channel = (await created.json()).data;
  assert.equal((await request(`/api/channels/${channel.id}/sync`,'POST',{})).status,409);
  repository.upsertRemoteClips(channel.id,[{
    youtubeChannelId: channelData.youtubeChannelId, youtubeVideoId:'abcdefghijk',title:'実際の台詞',description:'テスト',
    publishedAt:'2026-09-09T00:00:00Z',durationSeconds:30,thumbnailUrl:null,viewCount:null,likeCount:null,commentCount:null,
  }]);
  const listing = await (await request('/api/clips?q=台詞')).json();
  assert.equal(listing.total,1);
  const clip = listing.data[0];
  assert.equal((await request(`/api/clips/${clip.id}/download`,'POST',{quality:'720p',subtitles:false})).status,409);
  const selected = await request(`/api/clips/${clip.id}/review`,'PATCH',{
    expectedRevision:clip.revision,decision:'select',humanConfirmed:true,patch:{reviewNotes:'사람 검수 완료'},
  });
  assert.equal(selected.status,200);
  assert.equal((await selected.json()).data.status,'SELECTED');
  const accepted = await request(`/api/clips/${clip.id}/download`,'POST',{quality:'720p',subtitles:true});
  assert.equal(accepted.status,202);
  const job = (await accepted.json()).data;
  const outcome = await (await request(`/api/jobs/${job.id}`)).json();
  assert.equal(outcome.data.state,'FAILED');
  assert.equal(repository.getClip(clip.id).status,'SELECTED');
  assert.equal((await request(`/api/clips/${clip.id}/review`,'PATCH',{expectedRevision:clip.revision,decision:'reject'})).status,409);
  assert.equal((await request('/api/clips?limit=0')).status,400);
  assert.equal((await request('/api/clips?status=UNSAFE')).status,400);
  const html = await request('/');
  assert.equal(html.status,200);
  assert.match(await html.text(),/html/i);
});

test('HTTP validates local requests before sync side effects and serializes active jobs', async (t) => {
  const repository = new SourceRepository(':memory:');
  const youtube = new YouTubeClient('test-key-never-sent');
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  youtube.collectChannel = async () => {
    calls++;
    await pending;
    throw new Error('simulated remote failure with test-key-never-sent');
  };
  const server = createAppServer({ repository, root: APP_PATHS.projectRoot, youtube });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    repository.close();
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const channel = repository.createChannel({ youtubeChannelId: 'UC' + 'b'.repeat(22), channelName: '検証',
    category: 'anime', sourcePriority: 'S', officialVerified: true, enabled: true, notes: '' });
  const syncPath = `/api/channels/${channel.id}/sync`;
  const post = (path: string, body: string, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
  });
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(base + syncPath, { method: 'POST',
      headers: { Host: 'attacker.example', 'Content-Type': 'application/json' } }, res => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.end('{}');
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await post(syncPath, '{}', { Origin: 'null' })).status, 403);
  assert.equal((await post(syncPath, '{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(syncPath, '{')).status, 400);
  assert.equal((await post(syncPath, '{"unexpected":true}')).status, 400);
  assert.equal((await post(syncPath, JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }))).status, 413);
  assert.equal(calls, 0);
  const accepted = await post(syncPath, '{}');
  assert.equal(accepted.status, 202);
  const job = (await accepted.json()).data;
  assert.equal(calls, 1);
  assert.equal((await post(syncPath, '{}')).status, 409);
  assert.equal((await fetch(`${base}/api/channels/${channel.id}`, { method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: channel.revision }),
  })).status, 409);
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  const result = await fetch(`${base}/api/jobs/${job.id}`);
  const payload = await result.json();
  assert.equal(payload.data.state, 'FAILED');
  assert.doesNotMatch(JSON.stringify(payload), /test-key-never-sent/);
  assert.equal(repository.listChannels()[0]!.lastSyncedVideoId, null);
});
