import { z } from 'zod';
import type { SourceTimeline } from './models.js';
import { validateCaptions } from './caption.js';
import type { Diagnostic } from './validation.js';

/** Grapheme limits are logical counts, not pixel measurements. No implicit defaults. */
export interface CaptionDisplayPolicy {
  maxGraphemesPerLine: number;
  maxLinesPerUnit: number;
  minUnitDurationMs: number;
}

export interface CaptionDisplayLine {
  /** Half-open UTF-16 offsets within the original Caption.text, including lineEnding. */
  sourceStart: number;
  sourceEnd: number;
  /** Plain text, excluding the original hard line ending; never HTML. */
  text: string;
  lineEnding: string;
  graphemeCount: number;
}

export interface CaptionDisplayUnit {
  origin: 'source';
  sourceCaptionId: number;
  sourceCaptionIndex: number;
  /** Zero-based within the source caption; not a new Caption ID. */
  unitIndex: number;
  sourceStart: number;
  sourceEnd: number;
  /** Exact slice of Caption.text, including original whitespace and newlines. */
  text: string;
  /** Source milliseconds, half-open. Not Output time or speech alignment. */
  startMs: number;
  endMs: number;
  lines: CaptionDisplayLine[];
}

export type CaptionDisplayResult =
  | { valid: true; policy: CaptionDisplayPolicy; units: CaptionDisplayUnit[]; diagnostics: Diagnostic[] }
  | { valid: false; units: null; diagnostics: Diagnostic[] };

const positiveInteger = z.number().int().positive();
const policySchema = z.strictObject({
  maxGraphemesPerLine: positiveInteger,
  maxLinesPerUnit: positiveInteger,
  minUnitDurationMs: positiveInteger,
});
const hardBreaks = new Set(['\r\n', '\n', '\r', '\u2028', '\u2029']);

function wrapText(text: string, limit: number, segmenter: Intl.Segmenter): CaptionDisplayLine[] {
  const lines: CaptionDisplayLine[] = [];
  let start = 0;
  let count = 0;
  const flush = (textEnd: number, end: number, lineEnding: string) => {
    lines.push({ sourceStart: start, sourceEnd: end, text: text.slice(start, textEnd), lineEnding, graphemeCount: count });
    start = end;
    count = 0;
  };
  for (const { segment, index } of segmenter.segment(text)) {
    if (hardBreaks.has(segment)) {
      // A hard break after a full line belongs to that line, not a phantom new line.
      flush(index, index + segment.length, segment);
    } else {
      if (count === limit) flush(index, index, '');
      count++;
    }
  }
  // A trailing hard break is preserved by the last line; it creates no empty page.
  if (start < text.length) flush(text.length, text.length, '');
  return lines;
}

/**
 * Generates source-linked display data only. Errors return no partial display plan.
 * Original captions, SRT data, overrides and surrounding time are never edited.
 */
export function buildCaptionDisplay(source: unknown, policy: CaptionDisplayPolicy): CaptionDisplayResult {
  const parsedPolicy = policySchema.safeParse(policy);
  const validation = validateCaptions(source);
  const diagnostics: Diagnostic[] = [...validation.diagnostics];
  if (!parsedPolicy.success) diagnostics.push(...parsedPolicy.error.issues.map(issue => ({
    severity: 'error' as const, code: 'CAPTION_DISPLAY_POLICY', path: `policy.${issue.path.join('.')}`, message: issue.message,
  })));
  if (!parsedPolicy.success || !validation.valid) return { valid: false, units: null, diagnostics };
  if (typeof Intl.Segmenter !== 'function') return { valid: false, units: null, diagnostics: [...diagnostics, {
    severity: 'error', code: 'CAPTION_DISPLAY_SEGMENTER', path: 'runtime', message: 'Intl.Segmenter with grapheme support is required; no code-point fallback',
  }] };
  const resolvedPolicy = parsedPolicy.data;
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  // validateCaptions already checked this strict Core shape, including safe integers.
  const captions = (source as SourceTimeline).captions;
  const units: CaptionDisplayUnit[] = [];
  captions.forEach((caption, sourceCaptionIndex) => {
    const lines = wrapText(caption.text, resolvedPolicy.maxGraphemesPerLine, segmenter);
    const unitCount = Math.ceil(lines.length / resolvedPolicy.maxLinesPerUnit);
    const duration = BigInt(caption.endMs) - BigInt(caption.startMs);
    if (duration < BigInt(unitCount) * BigInt(resolvedPolicy.minUnitDurationMs)) {
      diagnostics.push({ severity: 'error', code: 'CAPTION_DISPLAY_TOO_SHORT', path: `captions.${sourceCaptionIndex}`, message: `Cue ${caption.id} has ${duration}ms for ${unitCount} units requiring at least ${resolvedPolicy.minUnitDurationMs}ms each` });
      return;
    }
    const base = duration / BigInt(unitCount);
    const remainder = duration % BigInt(unitCount);
    let time = BigInt(caption.startMs);
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex++) {
      const unitLines = lines.slice(unitIndex * resolvedPolicy.maxLinesPerUnit, (unitIndex + 1) * resolvedPolicy.maxLinesPerUnit);
      const sourceStart = unitLines[0]!.sourceStart;
      const sourceEnd = unitLines[unitLines.length - 1]!.sourceEnd;
      const end = time + base + (BigInt(unitIndex) < remainder ? 1n : 0n);
      units.push({ origin: 'source', sourceCaptionId: caption.id, sourceCaptionIndex, unitIndex,
        sourceStart, sourceEnd, text: caption.text.slice(sourceStart, sourceEnd),
        startMs: Number(time), endMs: Number(end), lines: unitLines });
      time = end;
    }
  });
  if (diagnostics.some(d => d.severity === 'error')) return { valid: false, units: null, diagnostics };
  return { valid: true, policy: resolvedPolicy, units, diagnostics };
}
