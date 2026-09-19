import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStudioClient } from '../src/app/voicestudio/client.js';
import { detectVoiceStudioBackend } from '../src/app/voicestudio/detector.js';
import { VoiceStudioError } from '../src/app/voicestudio/models.js';

test('VoiceStudio endpoint is localhost-only and defaults to port 3900', () => {
  assert.equal(new VoiceStudioClient().endpoint, 'http://127.0.0.1:3900');
  assert.equal(new VoiceStudioClient({ endpoint: 'http://localhost:3910' }).endpoint, 'http://localhost:3910');
  for (const endpoint of ['https://127.0.0.1:3900', 'http://192.168.0.10:3900', 'http://127.0.0.1:3900/api']) {
    assert.throws(() => new VoiceStudioClient({ endpoint }), VoiceStudioError);
  }
});

test('VoiceStudio client maps ready and startup health payloads', async () => {
  const ready = new VoiceStudioClient({ fetch: async () => Response.json({ status: 'ready', version: '0.5.3' }) });
  assert.deepEqual(await ready.health(), {
    endpoint: 'http://127.0.0.1:3900', state: 'ready', payload: { status: 'ready', version: '0.5.3' }, version: '0.5.3',
  });
  const starting = new VoiceStudioClient({ fetch: async () => Response.json({ state: 'loading' }) });
  assert.equal((await starting.health()).state, 'starting');
});

test('VoiceStudio client reports unavailable backend without throwing', async () => {
  const client = new VoiceStudioClient({ fetch: async () => { throw new Error('connection refused'); } });
  const health = await client.health();
  assert.equal(health.state, 'unavailable');
  assert.equal(health.error?.code, 'BACKEND_UNAVAILABLE');
});

test('detector marks an existing backend as external', async () => {
  const client = new VoiceStudioClient({ fetch: async () => Response.json({ status: 'ready' }) });
  assert.deepEqual(await detectVoiceStudioBackend(client), {
    state: 'running', endpoint: 'http://127.0.0.1:3900', ownership: 'external',
    health: { endpoint: 'http://127.0.0.1:3900', state: 'ready', payload: { status: 'ready' } },
  });
});
