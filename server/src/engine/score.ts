import type { Status } from './types.js';
import type { CatchAll, ProbeOutcome } from './smtp.js';

export interface Candidate { email: string; pattern: string; status: Status; confidence: number; reason: string }
export interface ScoreArgs { rank: number; outcome: ProbeOutcome | 'no_mx' | 'not_probed'; catchAll: CatchAll }
export interface Score { status: Status; confidence: number; reason: string }

const cap = (base: number, rank: number, step: number, floor = 5) => Math.max(floor, base - rank * step);

export function scoreResult({ rank, outcome, catchAll }: ScoreArgs): Score {
  if (outcome === 'no_mx') return { status: 'invalid', confidence: 0, reason: 'no_mx' };
  if (outcome === 'reject') return { status: 'invalid', confidence: 0, reason: 'mailbox_rejected' };
  if (catchAll === 'catch_all') return { status: 'risky', confidence: cap(50, rank, 3), reason: 'catch_all' };
  if (outcome === 'accept') {
    return catchAll === 'not_catch_all'
      ? { status: 'valid', confidence: 99 - rank, reason: 'smtp_accepted' }
      : { status: 'risky', confidence: cap(60, rank, 2), reason: 'catch_all_unknown' };
  }
  const reason = outcome === 'temp' ? 'greylisted' : outcome === 'unreachable' ? 'smtp_unreachable' : 'not_probed';
  return { status: 'unknown', confidence: cap(40, rank, 3), reason };
}
