import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { APP_PATHS } from '../config.js';

const commit = '523d033d6cb47f4a80c58a35753646f5c3608a78';
const source = `https://raw.githubusercontent.com/notofonts/noto-cjk/${commit}`;
const licenseSha256 = '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2';
const files = [
  { weight: 400, fileName: 'NotoSansCJKkr-Regular.otf', sha256: '6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a' },
  { weight: 700, fileName: 'NotoSansCJKkr-Bold.otf', sha256: '26d0c6748500a0444844280b308f5b62c7ae92ac6c6ac88148e502dd211eb52a' },
].map(file => ({ ...file, format: 'opentype', url: `/fonts/noto-cjk/${file.fileName}`,
  sourceUrl: `${source}/Sans/OTF/Korean/${file.fileName}` }));

export const FONT_REGISTRY = [{
  id: 'noto-sans-cjk-kr', family: 'Noto Sans CJK KR', version: '2.004', sourceCommit: commit,
  languages: ['ko', 'ja', 'latin'], weights: [400, 700], bundled: true,
  licenseId: 'OFL-1.1', licenseTextPath: 'src/app/fonts/bundled/LICENSE',
  licenseUrl: '/fonts/noto-cjk/LICENSE', licenseSourceUrl: `${source}/LICENSE`, licenseSha256,
  sourceUrl: `https://github.com/notofonts/noto-cjk/tree/${commit}`, files,
}] as const;

/** Only verified, unmodified bytes enter the serving cache; no caller path is resolved. */
export class FontRegistry {
  readonly #files = new Map<string, { bytes: Buffer; mimeType: string; sha256: string }>();
  constructor(root = APP_PATHS.projectRoot) {
    const items = [
      ...files.map(file => ({ ...file, mimeType: 'font/otf' })),
      { fileName: 'LICENSE', url: '/fonts/noto-cjk/LICENSE', sha256: licenseSha256, mimeType: 'text/plain; charset=utf-8' },
    ];
    for (const item of items) {
      const bytes = readFileSync(join(root, 'src', 'app', 'fonts', 'bundled', item.fileName));
      if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
        throw new Error(`Bundled font integrity check failed: ${item.fileName}`);
      }
      this.#files.set(item.url, { bytes, mimeType: item.mimeType, sha256: item.sha256 });
    }
  }
  listFonts() { return structuredClone(FONT_REGISTRY); }
  serve(path: string, method: string, res: ServerResponse): boolean {
    const file = this.#files.get(path);
    if (!file || !['GET', 'HEAD'].includes(method)) return false;
    res.writeHead(200, {
      'Content-Type': file.mimeType, 'Content-Length': file.bytes.length,
      'Cache-Control': 'no-cache', 'ETag': `"${file.sha256}"`,
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(method === 'HEAD' ? undefined : file.bytes);
    return true;
  }
}
