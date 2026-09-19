import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { VoiceStudioError } from './models.js';
import type { VoiceStudioDownloadedInstaller, VoiceStudioDownloadOptions, VoiceStudioInstaller, VoiceStudioRelease } from './installer.js';

export interface VoiceStudioInstallLocation {
  executablePath: string;
}

export interface VoiceStudioInstallLocator {
  find(): Promise<VoiceStudioInstallLocation | undefined>;
}

export interface VoiceStudioInstallManagerOptions {
  download?: (release: VoiceStudioRelease, options: VoiceStudioDownloadOptions) => Promise<VoiceStudioDownloadedInstaller>;
  runInstaller?: (installerPath: string) => Promise<{ exitCode: number }>;
  locator?: VoiceStudioInstallLocator;
  sleep?: (ms: number) => Promise<void>;
}

export interface VoiceStudioInstallRequest extends VoiceStudioDownloadOptions {
  installTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface VoiceStudioInstallResult {
  installer: VoiceStudioDownloadedInstaller;
  installation: VoiceStudioInstallLocation;
}

function defaultRunInstaller(installerPath: string): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const isMsi = installerPath.toLowerCase().endsWith('.msi');
    const executable = isMsi ? 'msiexec.exe' : installerPath;
    const args = isMsi ? ['/i', installerPath] : [];
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', code => resolve({ exitCode: code ?? -1 }));
  });
}

export function defaultVoiceStudioInstallCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'VoiceStudio (Current User)', 'VoiceStudio.exe'));
    candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'VoiceStudio', 'VoiceStudio.exe'));
  }
  if (env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, 'VoiceStudio', 'VoiceStudio.exe'));
  return candidates;
}

export class FileVoiceStudioInstallLocator implements VoiceStudioInstallLocator {
  constructor(readonly candidates: readonly string[] = defaultVoiceStudioInstallCandidates()) {}

  async find(): Promise<VoiceStudioInstallLocation | undefined> {
    for (const candidate of this.candidates) {
      try { await access(candidate); return { executablePath: candidate }; }
      catch { /* continue */ }
    }
    return undefined;
  }
}

export class VoiceStudioInstallManager {
  readonly #download: NonNullable<VoiceStudioInstallManagerOptions['download']>;
  readonly #runInstaller: NonNullable<VoiceStudioInstallManagerOptions['runInstaller']>;
  readonly #locator: VoiceStudioInstallLocator;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(installer: VoiceStudioInstaller, options: VoiceStudioInstallManagerOptions = {}) {
    this.#download = options.download ?? ((release, request) => installer.downloadVerifiedInstaller(release, request));
    this.#runInstaller = options.runInstaller ?? defaultRunInstaller;
    this.#locator = options.locator ?? new FileVoiceStudioInstallLocator();
    this.#sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async install(release: VoiceStudioRelease, request: VoiceStudioInstallRequest): Promise<VoiceStudioInstallResult> {
    const installer = await this.#download(release, request);
    const process = await this.#runInstaller(installer.path);
    if (process.exitCode !== 0) throw new VoiceStudioError(
      'INSTALLER_EXITED',
      `VoiceStudio 설치 프로그램이 코드 ${process.exitCode}로 종료되었습니다.`,
      'unavailable',
      502,
      true,
      process.exitCode,
    );
    const timeoutMs = request.installTimeoutMs ?? 300_000;
    const pollIntervalMs = request.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (request.signal?.aborted) throw new VoiceStudioError('INSTALL_CANCELLED', 'VoiceStudio 설치가 취소되었습니다.', 'unavailable', 499, true);
      const installation = await this.#locator.find();
      if (installation) return { installer, installation };
      await this.#sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
    throw new VoiceStudioError('INSTALL_NOT_DETECTED', 'VoiceStudio 설치 완료를 확인하지 못했습니다.', 'unavailable', 504, true);
  }
}
