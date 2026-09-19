import { spawn, type ChildProcess } from 'node:child_process';
import { VoiceStudioError } from './models.js';
import { detectVoiceStudioBackend } from './detector.js';
import type { VoiceStudioClient } from './client.js';

export interface VoiceStudioProcessHandle {
  readonly pid?: number;
  terminate(): Promise<void>;
}

export interface VoiceStudioProcessRunner {
  spawn(executablePath: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): VoiceStudioProcessHandle;
}

export interface VoiceStudioProcessStartRequest {
  executablePath: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface VoiceStudioProcessState {
  ownership: 'external' | 'nihon-managed';
  endpoint: string;
  pid?: number;
}

function defaultRunner(): VoiceStudioProcessRunner {
  return {
    spawn(executablePath, args, options) {
      const child = spawn(executablePath, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      return {
        ...(child.pid === undefined ? {} : { pid: child.pid }),
        terminate: () => terminateChild(child),
      };
    },
  };
}

function terminateChild(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const done = () => resolve();
    child.once('close', done);
    if (!child.kill()) resolve();
  });
}

export class VoiceStudioProcessManager {
  readonly #client: VoiceStudioClient;
  readonly #runner: VoiceStudioProcessRunner;
  #managed: VoiceStudioProcessHandle | undefined;

  constructor(client: VoiceStudioClient, runner: VoiceStudioProcessRunner = defaultRunner()) {
    this.#client = client;
    this.#runner = runner;
  }

  async start(request: VoiceStudioProcessStartRequest): Promise<VoiceStudioProcessState> {
    const existing = await detectVoiceStudioBackend(this.#client);
    if (existing.state === 'running') return { ownership: 'external', endpoint: existing.endpoint };
    if (this.#managed) return { ownership: 'nihon-managed', endpoint: this.#client.endpoint, ...(this.#managed.pid === undefined ? {} : { pid: this.#managed.pid }) };

    const processOptions = {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.env === undefined ? {} : { env: request.env }),
    };
    const process = this.#runner.spawn(request.executablePath, request.args ?? [], processOptions);
    this.#managed = process;
    const timeoutMs = request.timeoutMs ?? 300_000;
    const pollIntervalMs = request.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() <= deadline) {
        const health = await this.#client.health();
        if (health.state === 'ready') return { ownership: 'nihon-managed', endpoint: this.#client.endpoint, ...(process.pid === undefined ? {} : { pid: process.pid }) };
        await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
      }
      throw new VoiceStudioError('BACKEND_START_TIMEOUT', 'VoiceStudio backend 준비 시간이 초과되었습니다.', 'unavailable', 504, true);
    } catch (error) {
      await process.terminate();
      this.#managed = undefined;
      if (error instanceof VoiceStudioError) throw error;
      throw new VoiceStudioError('BACKEND_START_FAILED', 'VoiceStudio backend 시작에 실패했습니다.', 'unavailable', 503, true);
    }
  }

  async stop(): Promise<void> {
    const process = this.#managed;
    this.#managed = undefined;
    if (process) await process.terminate();
  }

  get ownership(): VoiceStudioProcessState['ownership'] { return this.#managed ? 'nihon-managed' : 'external'; }
}
