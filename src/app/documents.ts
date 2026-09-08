import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { APP_PATHS } from './config.js';

export const ACTIVE_DOCUMENT_NAMES = Object.freeze([
  'NIHON_ZUPZUP_CODEX_MIGRATION_v3_2026-09-09.md',
  'nihon_zupzup_channel_plan_v1.4_2026-09-09.md',
  'nihon_zupzup_channel_settings_and_operation_v1.3_FINAL_2026-09-09.md',
  'nihon_zupzup_official_youtube_clip_source_rules_v1.1_FINAL_2026-09-09.md',
  'nihon_zupzup_anime_drama_quote_research_rules_v2.1_FINAL_2026-09-09.md',
  'nihon_zupzup_anime_speech_series_rules_v1.2_FINAL_2026-09-09.md',
  'nihon_zupzup_longform_thumbnail_rules_v1.4_FINAL_2026-09-09.md',
  'nihon_zupzup_shorts_thumbnail_rules_v1.1_FINAL_2026-09-09.md',
  'nihon_zupzup_thumbnail_editor_and_generation_rules_v1.0_FINAL_2026-09-09.md',
  'nihon_zupzup_tts_script_rules_v1.1_FINAL_2026-09-09.md',
  'nihon_zupzup_voicevox_integration_rules_v1.0_FINAL_2026-09-09.md',
  'vidiq_2026_youtube_thumbnail_research.md',
] as const);

export type ActiveDocumentName = (typeof ACTIVE_DOCUMENT_NAMES)[number];

export interface ActiveDocument {
  readonly name: ActiveDocumentName;
  readonly path: string;
  readonly content: string;
}

function loadFromRoot(readRoot: string): readonly ActiveDocument[] {
  const root = resolve(readRoot);

  return ACTIVE_DOCUMENT_NAMES.map((name) => {
    const documentPath = resolve(root, name);
    if (!documentPath.startsWith(`${root}${sep}`)) {
      throw new Error(`Active document path escaped the docs root: ${name}`);
    }

    try {
      return Object.freeze({
        name,
        path: documentPath,
        content: readFileSync(documentPath, 'utf8'),
      });
    } catch (error) {
      throw new Error(`Required active document is missing or unreadable: ${name}`, {
        cause: error,
      });
    }
  });
}

/** Load the exact active allowlist from the fixed application docs directory. */
export function loadActiveDocuments(): readonly ActiveDocument[] {
  return loadFromRoot(APP_PATHS.docs);
}

/** @internal Test seam for isolated filesystem fixtures. */
export function loadActiveDocumentsFromRootForTest(
  readRoot: string,
): readonly ActiveDocument[] {
  return loadFromRoot(readRoot);
}
