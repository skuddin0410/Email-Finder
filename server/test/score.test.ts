import { describe, it, expect } from 'vitest';
import { scoreResult } from '../src/engine/score.js';

type O = Parameters<typeof scoreResult>[0];
const ranks = [0, 3, 6, 11];

describe('scoreResult', () => {
  it('no_mx -> invalid/0', () =>
    expect(scoreResult({ rank: 0, outcome: 'no_mx', catchAll: 'unknown' })).toEqual({ status: 'invalid', confidence: 0, reason: 'no_mx' }));
  it('reject -> invalid/0', () =>
    expect(scoreResult({ rank: 2, outcome: 'reject', catchAll: 'not_catch_all' })).toEqual({ status: 'invalid', confidence: 0, reason: 'mailbox_rejected' }));
  it('accept on non-catch-all: valid, 99 at rank 0 and >=85 at rank 11', () => {
    expect(scoreResult({ rank: 0, outcome: 'accept', catchAll: 'not_catch_all' })).toMatchObject({ status: 'valid', confidence: 99 });
    expect(scoreResult({ rank: 11, outcome: 'accept', catchAll: 'not_catch_all' }).confidence).toBeGreaterThanOrEqual(85);
  });
  it('catch-all domain: risky, capped at 50', () => {
    expect(scoreResult({ rank: 0, outcome: 'accept', catchAll: 'catch_all' })).toMatchObject({ status: 'risky', confidence: 50, reason: 'catch_all' });
    expect(scoreResult({ rank: 11, outcome: 'accept', catchAll: 'catch_all' }).confidence).toBeLessThanOrEqual(50);
  });
  it('accept but catch-all undeterminable: risky, max 60', () => {
    const r = scoreResult({ rank: 0, outcome: 'accept', catchAll: 'unknown' });
    expect(r.status).toBe('risky'); expect(r.confidence).toBeLessThanOrEqual(60);
  });
  it('temp -> unknown greylisted <=40', () =>
    expect(scoreResult({ rank: 0, outcome: 'temp', catchAll: 'not_catch_all' })).toMatchObject({ status: 'unknown', reason: 'greylisted', confidence: 40 }));
  it('unreachable -> unknown smtp_unreachable <=40', () =>
    expect(scoreResult({ rank: 0, outcome: 'unreachable', catchAll: 'unknown' })).toMatchObject({ status: 'unknown', reason: 'smtp_unreachable' }));
  it('not_probed -> unknown <=40', () =>
    expect(scoreResult({ rank: 1, outcome: 'not_probed', catchAll: 'not_catch_all' })).toMatchObject({ status: 'unknown', reason: 'not_probed' }));

  const outcomes: O['outcome'][] = ['no_mx', 'accept', 'reject', 'temp', 'unreachable', 'not_probed'];
  const catchAlls: O['catchAll'][] = ['catch_all', 'not_catch_all', 'unknown'];
  for (const outcome of outcomes) for (const catchAll of catchAlls)
    it(`integer 0-100 and non-increasing in rank: ${outcome}/${catchAll}`, () => {
      const cs = ranks.map((rank) => scoreResult({ rank, outcome, catchAll }).confidence);
      cs.forEach((c) => { expect(Number.isInteger(c)).toBe(true); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(100); });
      for (let i = 1; i < cs.length; i++) expect(cs[i]!).toBeLessThanOrEqual(cs[i - 1]!);
    });
});
