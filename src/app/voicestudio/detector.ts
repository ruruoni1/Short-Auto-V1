import type { VoiceStudioClient } from './client.js';
import type { VoiceStudioBackendDetection } from './models.js';

export async function detectVoiceStudioBackend(client: VoiceStudioClient): Promise<VoiceStudioBackendDetection> {
  const health = await client.health();
  return {
    state: health.state === 'unavailable' ? 'not-running' : 'running',
    endpoint: client.endpoint,
    ownership: 'external',
    health,
  };
}
