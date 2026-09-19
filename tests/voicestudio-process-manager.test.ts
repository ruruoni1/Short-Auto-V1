import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStudioProcessManager, type VoiceStudioProcessRunner } from '../src/app/voicestudio/process-manager.js';
import { VoiceStudioClient } from '../src/app/voicestudio/client.js';
import { VoiceStudioError } from '../src/app/voicestudio/models.js';

function runner(onSpawn: () => void, onTerminate: () => void): VoiceStudioProcessRunner {
  return { spawn: (_executable, _args, _options) => { onSpawn(); return { pid: 1234, terminate: async () => onTerminate() }; } };
}

test('process manager attaches to an existing backend without spawning or owning it', async () => {
  let spawned = 0;
  const client = new VoiceStudioClient({ fetch: async () => Response.json({ status: 'ready' }) });
  const manager = new VoiceStudioProcessManager(client, runner(() => spawned += 1, () => {}));
  assert.deepEqual(await manager.start({ executablePath: 'C:\\VoiceStudio.exe' }), { ownership: 'external', endpoint: 'http://127.0.0.1:3900' });
  assert.equal(spawned, 0);
  await manager.stop();
});

test('process manager starts only when backend is unavailable and waits for readiness', async () => {
  let calls = 0;
  let spawned = 0;
  let terminated = 0;
  const client = new VoiceStudioClient({ fetch: async () => {
    calls += 1;
    if (calls === 1) throw new Error('not running');
    return Response.json(calls < 3 ? { status: 'starting' } : { status: 'ready' });
  }});
  const manager = new VoiceStudioProcessManager(client, runner(() => spawned += 1, () => terminated += 1));
  const state = await manager.start({ executablePath: 'C:\\VoiceStudio.exe', args: ['--host', '127.0.0.1'], pollIntervalMs: 1, timeoutMs: 100 });
  assert.equal(state.ownership, 'nihon-managed');
  assert.equal(state.pid, 1234);
  assert.equal(spawned, 1);
  await manager.stop();
  assert.equal(terminated, 1);
});

test('process manager terminates its child when readiness times out', async () => {
  let terminated = 0;
  const client = new VoiceStudioClient({ fetch: async () => { throw new Error('not ready'); } });
  const manager = new VoiceStudioProcessManager(client, runner(() => {}, () => terminated += 1));
  await assert.rejects(() => manager.start({ executablePath: 'C:\\VoiceStudio.exe', pollIntervalMs: 1, timeoutMs: 2 }), (error: unknown) => error instanceof VoiceStudioError && error.code === 'BACKEND_START_TIMEOUT');
  assert.equal(terminated, 1);
});
