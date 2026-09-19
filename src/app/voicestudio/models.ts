export const DEFAULT_VOICESTUDIO_ENDPOINT = 'http://127.0.0.1:3900';

export type VoiceStudioHealthState = 'ready' | 'starting' | 'unavailable' | 'error';

export class VoiceStudioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: 'configuration' | 'unavailable' | 'http' | 'invalid_response',
    readonly status: number,
    readonly retriable: boolean,
    readonly engineStatus?: number,
  ) {
    super(message);
    this.name = 'VoiceStudioError';
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      kind: this.kind,
      retriable: this.retriable,
      ...(this.engineStatus === undefined ? {} : { engineStatus: this.engineStatus }),
    };
  }
}

export function parseVoiceStudioEndpoint(value = DEFAULT_VOICESTUDIO_ENDPOINT): URL {
  let endpoint: URL;
  try { endpoint = new URL(value); }
  catch { throw new VoiceStudioError('ENDPOINT_INVALID', 'VoiceStudio endpoint 주소가 올바르지 않습니다.', 'configuration', 400, false); }
  const allowed = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' || endpoint.hostname === '[::1]';
  if (endpoint.protocol !== 'http:' || !allowed || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || (endpoint.pathname !== '/' && endpoint.pathname !== '')) {
    throw new VoiceStudioError('ENDPOINT_NOT_LOCAL', 'VoiceStudio endpoint는 로컬 HTTP 주소만 사용할 수 있습니다.', 'configuration', 400, false);
  }
  endpoint.pathname = '/';
  return endpoint;
}

export interface VoiceStudioHealth {
  endpoint: string;
  state: VoiceStudioHealthState;
  payload?: unknown;
  version?: string;
  error?: ReturnType<VoiceStudioError['toJSON']>;
}

export interface VoiceStudioBackendDetection {
  state: 'running' | 'not-running';
  endpoint: string;
  ownership: 'external';
  health: VoiceStudioHealth;
}
