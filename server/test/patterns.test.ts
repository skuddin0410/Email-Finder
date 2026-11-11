import { describe, it, expect } from 'vitest';
import { generatePatterns } from '../src/engine/patterns.js';

describe('generatePatterns', () => {
  it('returns the 12 ranked patterns in order', () => {
    const p = generatePatterns('jane', 'doe', 'acme.com');
    expect(p.map((x) => x.email)).toEqual([
      'jane.doe', 'jane', 'jdoe', 'janed', 'jane_doe', 'doe.jane', 'j.doe', 'doe', 'janedoe', 'doej', 'jane-doe', 'doejane',
    ].map((l) => `${l}@acme.com`));
    expect(p.map((x) => x.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(p.map((x) => x.pattern)).toEqual([
      'first.last', 'first', 'flast', 'firstl', 'first_last', 'last.first', 'f.last', 'last', 'firstlast', 'lastf', 'first-last', 'lastfirst',
    ]);
  });
  it('single name yields only first', () => {
    const p = generatePatterns('madonna', '', 'acme.com');
    expect(p).toEqual([{ email: 'madonna@acme.com', pattern: 'first', rank: 0 }]);
  });
  it('dedupes and never emits empty/undefined parts', () => {
    const p = generatePatterns('j', 'd', 'acme.com');
    const emails = p.map((x) => x.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.join()).not.toMatch(/undefined|^@|,@/);
    expect(p.map((x) => x.rank)).toEqual(p.map((_, i) => i));
  });
});
