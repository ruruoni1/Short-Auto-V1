import { SourceTimelineSchema } from './models.js';
import type { Caption, SourceTimeline } from './models.js';
import type { Diagnostic, ValidationResult } from './validation.js';

export interface CaptionDiagnostic extends Diagnostic {
  /** Zero-based source cue index; line numbers are one-based. */
  cueIndex?: number;
  line?: number;
}
export interface SrtCue {
  index: number;
  line: number;
  /** UTF-16 offsets into originalSrt, end exclusive; excludes delimiter/newline after cue. */
  startOffset: number;
  endOffset: number;
  raw: string;
  numberLine: string;
  timingLine: string | null;
  text: string;
  /** Null for a syntactically invalid cue; never renumbered or split. */
  caption: Caption | null;
}
export type SrtDuration =
  | { kind: 'provided'; durationMs: number }
  | { kind: 'inferred-last-cue'; durationMs: number }
  | { kind: 'unavailable'; durationMs: null };
export interface ParseSrtOptions { durationMs?: number; }
export interface ParseSrtResult {
  valid: boolean;
  originalSrt: string;
  cues: SrtCue[];
  diagnostics: CaptionDiagnostic[];
  duration: SrtDuration;
  /** Only available when all parsing and validation checks pass. */
  source: SourceTimeline | null;
}

/** Validates a standalone Core SourceTimeline without modifying or sorting it. */
export function validateCaptions(input: unknown): ValidationResult {
  const parsed = SourceTimelineSchema.safeParse(input);
  if (!parsed.success) return { valid: false, diagnostics: parsed.error.issues.map(issue => ({
    severity: 'error', code: 'CAPTION_SCHEMA', path: issue.path.join('.'), message: issue.message,
  })) };
  const { captions, durationMs } = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, index: number, field: string, message: string) => {
    diagnostics.push({ severity: 'error', code, path: `captions.${index}.${field}`, message });
  };
  const ids = new Set<number>();
  // Sorted scratch copy detects intersections even in reversed input or nested cues.
  const intervals = captions.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.startMs - b.cue.startMs || a.index - b.index);
  let furthest: typeof intervals[number] | undefined;
  for (const item of intervals) {
    if (furthest && item.cue.startMs < furthest.cue.endMs) error('CAPTION_OVERLAP', item.index, 'startMs', `Overlaps caption at index ${furthest.index}`);
    if (!furthest || item.cue.endMs > furthest.cue.endMs) furthest = item;
  }
  captions.forEach((cue, index) => {
    const previous = captions[index - 1];
    if (ids.has(cue.id)) error('CAPTION_DUPLICATE_ID', index, 'id', `Duplicate caption ID ${cue.id}`);
    ids.add(cue.id);
    if (previous && cue.id <= previous.id) error('CAPTION_ID_ORDER', index, 'id', 'Caption IDs must increase in source order; gaps are allowed');
    if (previous && cue.startMs < previous.startMs) error('CAPTION_TIME_ORDER', index, 'startMs', 'Caption start times are reversed');
    if (cue.endMs > durationMs) error('CAPTION_OUTSIDE_DURATION', index, 'endMs', 'Caption ends after source duration');
    if (!cue.text.trim()) error('CAPTION_EMPTY_TEXT', index, 'text', 'Caption contains only whitespace');
  });
  if (!captions.length) diagnostics.push({ severity: 'warning', code: 'CAPTION_EMPTY', path: 'captions', message: 'Source timeline contains no captions' });
  return { valid: !diagnostics.some(d => d.severity === 'error'), diagnostics };
}

interface Line { text: string; start: number; end: number; number: number; }
const timingPattern = /^[ \t]*(\d{2,}:[0-5]\d:[0-5]\d,\d{3})[ \t]+-->[ \t]+(\d{2,}:[0-5]\d:[0-5]\d,\d{3})[ \t]*$/;
function timestampMs(value: string): number {
  const [hours, minutes, seconds, millis] = value.split(/[:,]/).map(Number);
  return hours! * 3600000 + minutes! * 60000 + seconds! * 1000 + millis!;
}

/** Strict SRT import. Preserves the original string, cue text, IDs and millisecond times. */
export function parseSrt(originalSrt: string, options: ParseSrtOptions = {}): ParseSrtResult {
  const diagnostics: CaptionDiagnostic[] = [];
  const cues: SrtCue[] = [];
  const lines: Line[] = [];
  const linePattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of originalSrt.matchAll(linePattern)) {
    if (!match[0]) break;
    lines.push({ text: match[1]!, start: match.index, end: match.index + match[1]!.length, number: lines.length + 1 });
    if (match[2] === '\r') diagnostics.push({ severity: 'error', code: 'SRT_LINE_ENDING', path: 'originalSrt', line: lines.length, message: 'Bare CR is unsupported; use LF or CRLF' });
  }
  const syntaxText = (line: Line) => line.number === 1 ? line.text.replace(/^\uFEFF/, '') : line.text;
  let cursor = 0;
  while (cursor < lines.length) {
    if (!syntaxText(lines[cursor]!).trim()) { cursor++; continue; }
    const begin = cursor;
    while (cursor < lines.length && syntaxText(lines[cursor]!).trim()) cursor++;
    const block = lines.slice(begin, cursor);
    const first = block[0]!;
    const last = block[block.length - 1]!;
    const index = cues.length;
    const cue: SrtCue = { index, line: first.number, startOffset: first.start, endOffset: last.end,
      raw: originalSrt.slice(first.start, last.end), numberLine: first.text, timingLine: block[1]?.text ?? null,
      text: block.length > 2 ? originalSrt.slice(block[2]!.start, last.end) : '', caption: null };
    const before = diagnostics.length;
    const error = (code: string, field: string, line: number, message: string) => diagnostics.push({ severity: 'error', code, path: `cues.${index}.${field}`, cueIndex: index, line, message });
    const number = syntaxText(first).trim();
    const id = Number(number);
    if (!/^\d+$/.test(number) || !Number.isSafeInteger(id) || id < 1) error('SRT_NUMBER', 'numberLine', first.number, 'Cue number must be a safe integer >= 1; no automatic renumbering');
    const timing = cue.timingLine?.match(timingPattern);
    let startMs = 0;
    let endMs = 0;
    if (!timing) error('SRT_TIME_FORMAT', 'timingLine', first.number + 1, 'Expected HH:MM:SS,mmm --> HH:MM:SS,mmm with minutes/seconds 00–59');
    else {
      startMs = timestampMs(timing[1]!); endMs = timestampMs(timing[2]!);
      if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) error('SRT_TIME_RANGE', 'timingLine', first.number + 1, 'Timestamp exceeds safe integer milliseconds');
      else if (endMs <= startMs) error('SRT_TIME_INTERVAL', 'timingLine', first.number + 1, 'Cue end must be strictly after start');
    }
    if (!cue.text.trim()) error('SRT_EMPTY_TEXT', 'text', first.number + 2, 'Cue needs nonblank text');
    for (let i = 2; i + 1 < block.length; i++) {
      if (/^\d+$/.test(block[i]!.text.trim()) && timingPattern.test(block[i + 1]!.text)) error('SRT_MISSING_SEPARATOR', 'text', block[i]!.number, 'Possible cue header inside text; separate cues with a blank line');
    }
    if (diagnostics.length === before) cue.caption = { id, startMs, endMs, text: cue.text };
    cues.push(cue);
  }
  if (!cues.length) diagnostics.push({ severity: 'error', code: 'SRT_EMPTY', path: 'originalSrt', message: 'SRT contains no cues' });
  let duration: SrtDuration = { kind: 'unavailable', durationMs: null };
  if (options.durationMs !== undefined) {
    if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0) diagnostics.push({ severity: 'error', code: 'SRT_DURATION', path: 'options.durationMs', message: 'Provided source duration must be a positive safe integer in milliseconds' });
    else duration = { kind: 'provided', durationMs: options.durationMs };
  } else if (cues.length && cues.every(cue => cue.caption !== null)) {
    duration = { kind: 'inferred-last-cue', durationMs: cues[cues.length - 1]!.caption!.endMs };
    diagnostics.push({ severity: 'warning', code: 'SRT_DURATION_INFERRED', path: 'duration', message: 'Duration is the last cue end only; actual audio duration and trailing silence are unknown' });
  }
  let candidate: SourceTimeline | null = null;
  if (duration.durationMs !== null && cues.every(cue => cue.caption !== null)) {
    candidate = { durationMs: duration.durationMs, captions: cues.map(cue => cue.caption!) };
    diagnostics.push(...validateCaptions(candidate).diagnostics.map(d => {
      const index = /^captions\.(\d+)/.exec(d.path)?.[1];
      if (index === undefined) return d;
      const cueIndex = Number(index);
      return { ...d, cueIndex, line: cues[cueIndex]!.line };
    }));
  }
  const valid = !diagnostics.some(d => d.severity === 'error');
  return { valid, originalSrt, cues, diagnostics, duration, source: valid ? candidate : null };
}
