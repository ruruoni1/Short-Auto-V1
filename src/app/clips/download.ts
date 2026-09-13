import { spawn } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DownloadOptions, SourceClip } from './models.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov']);
const AUDIO_EXTENSIONS = new Set(['.m4a', '.mp3', '.opus', '.wav', '.aac', '.flac']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.lrc']);

export interface RunOptions {
  cwd: string;
  shell: false;
}

export interface RunResult {
  exitCode: number;
}

export type DownloadRunner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

export interface DownloadDependencies {
  root: string;
  run?: DownloadRunner;
}

export interface DownloadedClipPaths {
  localVideoPath: string;
  subtitlePath?: string;
  localAudioPath?: string;
}

function runProcess(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('close', code => resolve({ exitCode: code ?? -1 }));
  });
}

const defaultRunner: DownloadRunner = async (command, args, options) => {
  try {
    return await runProcess(command, args, options);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (command !== 'yt-dlp' || code !== 'ENOENT') throw new Error('yt-dlp could not be started');
    try {
      return await runProcess('python', ['-m', 'yt_dlp', ...args], options);
    } catch {
      throw new Error('yt-dlp could not be started');
    }
  }
};

function assertDownloadable(clip: SourceClip): void {
  if (clip.status !== 'SELECTED' || typeof clip.reviewedAt !== 'string') {
    throw new Error('Clip download requires SELECTED status and completed human review');
  }
  if (!VIDEO_ID.test(clip.youtubeVideoId)) throw new Error('Clip download requires a valid YouTube video ID');
  if (clip.contentType !== 'anime' && clip.contentType !== 'drama') throw new Error('Clip download requires a supported content category');
}

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function findOutput(directory: string, extensions: Set<string>, prefix?: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.part')) continue;
    if (prefix && !entry.name.startsWith(prefix)) continue;
    if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
    const candidate = path.join(directory, entry.name);
    if ((await stat(candidate)).size > 0) return candidate;
  }
  return undefined;
}

function projectRelative(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Downloaded output escaped the project root');
  }
  return relative.split(path.sep).join('/');
}

export async function downloadSelectedClip(
  clip: SourceClip,
  options: DownloadOptions,
  dependencies: DownloadDependencies,
): Promise<DownloadedClipPaths> {
  assertDownloadable(clip);
  if (dependencies.root.trim().length === 0) throw new Error('Download requires a project root');
  const root = path.resolve(dependencies.root);
  const jobDirectory = path.resolve(root, 'assets', 'media', clip.contentType, clip.youtubeVideoId, randomUUID());
  if (!insideRoot(root, jobDirectory)) throw new Error('Download target escaped the project root');
  await mkdir(jobDirectory, { recursive: true });

  const run = dependencies.run ?? defaultRunner;
  const format = options.quality === 'best'
    ? 'bv*+ba/b'
    : `bv*[height<=${options.quality === '1080p' ? 1080 : 720}]+ba/b[height<=${options.quality === '1080p' ? 1080 : 720}]`;
  const url = `https://www.youtube.com/watch?v=${clip.youtubeVideoId}`;
  const videoTemplate = path.join(jobDirectory, 'source.%(ext)s');
  const videoArgs = [
    '--ignore-config',
    '--no-playlist',
    '--no-overwrites',
    '--restrict-filenames',
    '--socket-timeout',
    '30',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--format',
    format,
    '--merge-output-format',
    'mp4',
    '--write-info-json',
    '--clean-info-json',
    '--output',
    videoTemplate,
  ];
  if (options.subtitles) {
    videoArgs.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'ja',
      '--sub-format',
      'srt/vtt/best',
      '--convert-subs',
      'srt',
    );
  }
  videoArgs.push(url);

  const videoResult = await run('yt-dlp', videoArgs, { cwd: jobDirectory, shell: false });
  if (videoResult.exitCode !== 0) throw new Error(`yt-dlp video download exited with code ${videoResult.exitCode}`);
  const localVideo = await findOutput(jobDirectory, VIDEO_EXTENSIONS, 'source.');
  if (!localVideo) throw new Error('yt-dlp did not produce a nonempty video file');

  const subtitle = options.subtitles ? await findOutput(jobDirectory, SUBTITLE_EXTENSIONS, 'source.') : undefined;
  const localAudio = await findOutput(jobDirectory, AUDIO_EXTENSIONS, 'audio.');
  return {
    localVideoPath: projectRelative(root, localVideo),
    ...(subtitle ? { subtitlePath: projectRelative(root, subtitle) } : {}),
    ...(localAudio ? { localAudioPath: projectRelative(root, localAudio) } : {}),
  };
}
