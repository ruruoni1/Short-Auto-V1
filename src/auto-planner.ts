import { z } from 'zod';
import { AssetRegistrySchema, CaptionSchema, SceneSchema, SceneTypeSchema, SourceTimelineSchema } from './models.js';
import type { AssetRegistry, Caption, Scene } from './models.js';
import type { Diagnostic } from './validation.js';

const PlannerInputSchema = z.strictObject({
  source: SourceTimelineSchema,
  assets: AssetRegistrySchema.default({}),
  existingScenes: z.array(SceneSchema).default([]),
});

export interface AutoScenePlannerInput {
  source: unknown;
  assets?: unknown;
  existingScenes?: unknown;
}

export interface AutoScenePlannerResult {
  valid: boolean;
  scenes: Scene[] | null;
  diagnostics: Diagnostic[];
}

const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;
const korean = /[\uac00-\ud7a3]/u;
const quote = /[「」『』"“”'']/u;
const question = /[?？]|\b(?:why|how|what|when|where)\b|왜|어떻게|무엇|어째서|なぜ|どうして|どうやって|何/u;
const compare = /\b(?:vs|versus|difference|different|than)\b|보다|차이|비교|반면|대비|違い|比較|より|一方/u;
const relation = /때문|관계|연결|이유|결국|because|therefore|reason|から|ので|関係|理由/u;
const concept = /(?:란|이란|뜻|의미|정의|개념|means|meaning|defined|とは|意味|定義)/u;
const recap = /(?:정리|요약|다시|결론|마지막|recap|summary|in short|まとめ|結論|最後)/iu;
type SceneType = Scene['type'];

function diagnostic(code: string, path: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic {
  return { severity, code, path, message };
}

function words(text: string): string[] {
  const normalized = text.replace(/[\r\n]+/gu, ' ').replace(/[.,!?？。，、:;「」『』“”()[\]{}]/gu, ' ');
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...segmenter.segment(normalized)]
      .filter(part => part.isWordLike)
      .map(part => part.segment.trim())
      .filter(Boolean);
  }
  return normalized.split(/\s+/u).filter(Boolean);
}

function mainText(text: string): string | null {
  const tokens = words(text).slice(0, 7);
  return tokens.length ? tokens.join(japanese.test(text) && !/\s/u.test(text) ? '' : ' ') : null;
}

function classify(caption: Caption, index: number, total: number): { type: SceneType; confidence: number } {
  const text = caption.text.trim();
  const early = index < Math.max(1, Math.ceil(total * 0.2));
  const late = index >= Math.floor(total * 0.7);
  if (early && (question.test(text) || /[!！]/u.test(text))) return { type: 'HOOK', confidence: 0.86 };
  if (late && recap.test(text)) return { type: 'RECAP', confidence: 0.88 };
  if (compare.test(text)) return { type: 'COMPARE', confidence: 0.84 };
  if (quote.test(text)) return { type: 'QUOTE_ANALYSIS', confidence: 0.82 };
  if (question.test(text)) return { type: 'QUESTION', confidence: 0.86 };
  if (relation.test(text)) return { type: 'RELATION', confidence: 0.78 };
  if (concept.test(text)) return { type: 'CONCEPT', confidence: 0.8 };
  if (words(text).length <= 4 && (korean.test(text) || japanese.test(text))) return { type: 'KEYWORD', confidence: 0.68 };
  return { type: 'EXPLAIN', confidence: 0.55 };
}

function strategy(type: SceneType): Scene['visual']['strategy'] {
  switch (type) {
    case 'KEYWORD': case 'QUESTION': return 'text_only';
    case 'COMPARE': case 'RELATION': case 'RECAP': case 'QUOTE_ANALYSIS': return 'generated_graphic';
    case 'CONCEPT': return 'text_only';
    case 'EXPLAIN': return 'auto';
    case 'HOOK': return 'auto';
    default: return 'auto';
  }
}

function lockedCoverage(existing: Scene[], captions: Caption[], diagnostics: Diagnostic[]): Map<number, Scene> {
  const byCaption = new Map<number, Scene>();
  for (const scene of existing.filter(item => item.locked)) {
    const covered = captions.filter(c => c.id >= scene.captionRange.start && c.id <= scene.captionRange.end);
    if (!covered.length || covered[0]!.id !== scene.captionRange.start || covered.at(-1)!.id !== scene.captionRange.end) {
      diagnostics.push(diagnostic('PLANNER_LOCKED_RANGE', `existingScenes.${scene.id}.captionRange`, 'Locked Scene range must reference existing captions'));
      continue;
    }
    for (const caption of covered) {
      if (byCaption.has(caption.id)) diagnostics.push(diagnostic('PLANNER_LOCKED_OVERLAP', `existingScenes.${scene.id}.captionRange`, `Locked Scenes overlap caption ${caption.id}`));
      else byCaption.set(caption.id, structuredClone(scene));
    }
  }
  return byCaption;
}

/**
 * Deterministic, review-first planner. It classifies each caption without
 * changing source text or creating assets. Locked existing Scenes are copied
 * through unchanged and their caption ranges are never replanned.
 */
export function planScenes(input: AutoScenePlannerInput): AutoScenePlannerResult {
  const parsed = PlannerInputSchema.safeParse(input);
  if (!parsed.success) return { valid: false, scenes: null, diagnostics: parsed.error.issues.map(issue => diagnostic('PLANNER_SCHEMA', issue.path.join('.'), issue.message)) };
  const { source, existingScenes } = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const locked = lockedCoverage(existingScenes, source.captions, diagnostics);
  if (diagnostics.some(item => item.severity === 'error')) return { valid: false, scenes: null, diagnostics };

  const scenes: Scene[] = [];
  const covered = new Set<number>();
  for (const [index, caption] of source.captions.entries()) {
    const preserved = locked.get(caption.id);
    if (preserved) {
      if (!covered.has(caption.id)) scenes.push(preserved);
      covered.add(caption.id);
      continue;
    }
    const { type, confidence } = classify(caption, index, source.captions.length);
    const text = mainText(caption.text);
    scenes.push({
      id: `scene_${String(scenes.length + 1).padStart(3, '0')}`,
      type,
      locked: false,
      confidence,
      captionRange: { start: caption.id, end: caption.id },
      captionMode: 'normal',
      content: { mainText: text, subText: null, jpText: null, sourceText: caption.text, emphasis: text ? words(text).slice(0, 2) : [] },
      visual: { strategy: strategy(type), assetId: null },
      motion: null,
    });
    covered.add(caption.id);
  }
  if (!scenes.length) diagnostics.push(diagnostic('PLANNER_EMPTY', 'source.captions', 'At least one caption is required'));
  if (scenes.some(scene => scene.confidence < 0.7)) diagnostics.push(diagnostic('PLANNER_REVIEW', 'scenes', 'Low-confidence Scenes require human review', 'warning'));
  return { valid: !diagnostics.some(item => item.severity === 'error'), scenes, diagnostics };
}

export type { AssetRegistry };
