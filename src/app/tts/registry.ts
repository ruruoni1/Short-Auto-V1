import type { TTSProvider } from './types.js';

export class TTSProviderRegistry {
  readonly #providers = new Map<string, TTSProvider>();

  register(provider: TTSProvider): void {
    if (this.#providers.has(provider.id)) throw new Error(`TTS provider already registered: ${provider.id}`);
    this.#providers.set(provider.id, provider);
  }

  get(id: string): TTSProvider {
    const provider = this.#providers.get(id);
    if (!provider) throw new Error(`TTS provider not found: ${id}`);
    return provider;
  }

  has(id: string): boolean { return this.#providers.has(id); }

  list(): TTSProvider[] { return [...this.#providers.values()]; }
}
