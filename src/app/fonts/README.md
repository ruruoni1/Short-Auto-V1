# Bundled Noto Sans CJK KR

The application includes unmodified Regular (400) and Bold (700) OpenType fonts
from the official [notofonts/noto-cjk repository](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78).

- Pinned commit: `523d033d6cb47f4a80c58a35753646f5c3608a78`
- Embedded font version verified in both name tables: `Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603`
- Embedded copyright notice: © 2014-2021 Adobe (http://www.adobe.com/).
- License: SIL Open Font License 1.1 (`OFL-1.1`). The exact upstream root LICENSE is preserved at `bundled/LICENSE`.
- Source paths: `Sans/OTF/Korean/NotoSansCJKkr-Regular.otf` and `Sans/OTF/Korean/NotoSansCJKkr-Bold.otf` at the pinned commit.
- Download and verification date: 2026-09-14.

`registry.ts` records the exact official source URLs, version, weights, license,
and SHA-256 for both fonts and the full license. Startup verifies every file
before advertising the fonts. A missing or changed bundle fails initialization.
The server serves only the three allowlisted files from verified memory through
same-origin routes; it provides no arbitrary filesystem or user-output font download API.

The Korean regional build includes Korean, Japanese and Latin glyphs; Japanese
text uses this build's glyph forms. A distinct Japanese regional font family is
not bundled. The browser must load the requested registered weight before export.

Distributions must retain the original font bytes, `bundled/LICENSE`, this
copyright notice and the registry. The TypeScript build does not copy static
assets; launch from the configured project root containing `src/app/fonts/bundled`
and `src/app/web`, as with the other application static assets.
