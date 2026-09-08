import { win32 } from 'node:path';

/** The single canonical root for the local Short-auto application. */
export const PROJECT_ROOT = String.raw`D:\coding\Short-auto`;

export const APP_PATHS = Object.freeze({
  projectRoot: PROJECT_ROOT,
  docs: win32.join(PROJECT_ROOT, 'docs'),
  data: win32.join(PROJECT_ROOT, 'data'),
  assets: win32.join(PROJECT_ROOT, 'assets'),
  output: win32.join(PROJECT_ROOT, 'output'),
  temp: win32.join(PROJECT_ROOT, 'temp'),
});
