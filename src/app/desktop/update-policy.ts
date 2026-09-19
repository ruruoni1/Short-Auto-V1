import {
  type ContractDiagnostic,
  type ReleaseChannel,
  type ReleaseManifest,
  validateReleaseManifest,
} from './contract.js';

export type UpdateDecisionReason = 'update_available' | 'up_to_date' | 'channel_not_allowed' | 'invalid_input';

export interface UpdatePolicyInput {
  currentVersion: string;
  currentChannel: ReleaseChannel;
  manifest: unknown;
}

export interface UpdatePolicyDiagnostic {
  code: 'invalid_current_version' | 'invalid_current_channel' | 'invalid_manifest';
  path: string;
  message: string;
  details?: readonly ContractDiagnostic[];
}

export interface UpdateDecision {
  ok: boolean;
  shouldUpdate: boolean;
  reason: UpdateDecisionReason;
  diagnostics: readonly UpdatePolicyDiagnostic[];
  manifest?: ReleaseManifest;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type ParsedVersion = [number, number, number, readonly string[]];

function parseVersion(value: unknown): ParsedVersion | undefined {
  if (typeof value !== 'string') return undefined;
  const match = VERSION.exec(value);
  if (!match) return undefined;
  return [Number(match[1]!), Number(match[2]!), Number(match[3]!), match[4] ? match[4].split('.') : []];
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! > right[index]! ? 1 : -1;
  }
  const leftPre = left[3];
  const rightPre = right[3];
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;
  const length = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= leftPre.length) return -1;
    if (index >= rightPre.length) return 1;
    const leftPart = leftPre[index]!;
    const rightPart = rightPre[index]!;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function diagnostic(code: UpdatePolicyDiagnostic['code'], path: string, message: string, details?: readonly ContractDiagnostic[]): UpdatePolicyDiagnostic {
  return { code, path, message, ...(details ? { details } : {}) };
}

/** Purely decides whether a validated release manifest is eligible and newer. */
export function decideDesktopUpdate(input: UpdatePolicyInput): UpdateDecision {
  const diagnostics: UpdatePolicyDiagnostic[] = [];
  const current = parseVersion(input?.currentVersion);
  if (!current) diagnostics.push(diagnostic('invalid_current_version', 'currentVersion', 'Current version must use semantic versioning.'));
  if (input?.currentChannel !== 'stable' && input?.currentChannel !== 'beta') diagnostics.push(diagnostic('invalid_current_channel', 'currentChannel', 'Current channel must be stable or beta.'));
  const manifestResult = validateReleaseManifest(input?.manifest);
  if (!manifestResult.ok || !manifestResult.value) diagnostics.push(diagnostic('invalid_manifest', 'manifest', 'Release manifest is invalid.', manifestResult.diagnostics));
  if (diagnostics.length > 0) return { ok: false, shouldUpdate: false, reason: 'invalid_input', diagnostics };

  const manifest = manifestResult.value as ReleaseManifest;
  const channelAllowed = input.currentChannel === 'beta' || manifest.channel === 'stable';
  if (!channelAllowed) return { ok: true, shouldUpdate: false, reason: 'channel_not_allowed', diagnostics: [], manifest };
  const comparison = compareVersions(parseVersion(manifest.version)!, current!);
  if (comparison <= 0) return { ok: true, shouldUpdate: false, reason: 'up_to_date', diagnostics: [], manifest };
  return { ok: true, shouldUpdate: true, reason: 'update_available', diagnostics: [], manifest };
}
