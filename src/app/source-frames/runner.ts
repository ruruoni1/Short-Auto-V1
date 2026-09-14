import { spawn } from 'node:child_process';

export interface FrameRunOptions {
  cwd: string;
  shell: false;
  timeoutMs: number;
}

export interface FrameRunResult {
  exitCode: number;
  stdout: string;
}

export type FrameProcessRunner = (
  command: 'ffmpeg' | 'ffprobe',
  args: readonly string[],
  options: FrameRunOptions,
) => Promise<FrameRunResult>;

const MAX_STDOUT = 64 * 1024;

export const runFrameProcess: FrameProcessRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: options.shell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const chunks: Buffer[] = [];
  let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => {
    if (length >= MAX_STDOUT) return;
    const remaining = MAX_STDOUT - length;
    const value = Buffer.from(chunk).subarray(0, remaining);
    chunks.push(value);
    length += value.length;
  });
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', code => {
    clearTimeout(timer);
    if (timedOut) reject(new Error(`${command} timed out`));
    else resolve({ exitCode: code ?? -1, stdout: Buffer.concat(chunks).toString('utf8') });
  });
});

export async function probeDurationMs(sourcePath: string, cwd: string, run: FrameProcessRunner): Promise<number> {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    sourcePath,
  ], { cwd, shell: false, timeoutMs: 30_000 });
  const seconds = Number(result.stdout.trim());
  if (result.exitCode !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Unable to probe source duration');
  const durationMs = Math.floor(seconds * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error('Invalid source duration');
  return durationMs;
}

export async function extractFrame(
  sourcePath: string,
  outputPath: string,
  timestampMs: number,
  format: 'jpeg' | 'png',
  cwd: string,
  run: FrameProcessRunner,
): Promise<void> {
  const codec = format === 'jpeg' ? 'mjpeg' : 'png';
  const result = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', (timestampMs / 1_000).toFixed(3),
    '-i', sourcePath,
    '-frames:v', '1',
    '-an', '-sn', '-dn',
    '-c:v', codec,
    '-f', 'image2',
    '-y', outputPath,
  ], { cwd, shell: false, timeoutMs: 60_000 });
  if (result.exitCode !== 0) throw new Error('Unable to extract frame');
}

