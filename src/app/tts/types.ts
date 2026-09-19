export type TTSProviderState = 'ready' | 'starting' | 'unavailable' | 'error';

export interface TTSProviderStatus {
  provider: string;
  displayName: string;
  state: TTSProviderState;
  version?: string;
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export interface TTSVoice {
  id: string;
  name: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface TTSSynthesisRequest {
  text: string;
  language?: string;
  voiceId?: string;
  outputPath?: string;
  speed?: number;
  style?: string;
  providerOptions?: Record<string, unknown>;
}

export interface TTSSynthesisResult {
  provider: string;
  engine?: string;
  outputPath?: string;
  audio: Uint8Array;
  durationMs?: number;
  sampleRate?: number;
  metadata?: Record<string, unknown>;
}

export interface TTSProvider {
  readonly id: string;
  readonly displayName: string;

  isAvailable(): Promise<boolean>;
  getStatus(): Promise<TTSProviderStatus>;
  listVoices(): Promise<TTSVoice[]>;
  synthesize(request: TTSSynthesisRequest): Promise<TTSSynthesisResult>;
  cancel?(jobId: string): Promise<void>;
  dispose?(): Promise<void>;
}
