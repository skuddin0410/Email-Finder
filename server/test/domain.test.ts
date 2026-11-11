import { describe, it, expect } from 'vitest';
import { normalizeDomain } from '../src/engine/domain.js';

describe('normalizeDomain', () => {
  it.each([
    ['https://www.Acme.COM/about?x=1', 'acme.com'],
    ['acme.com', 'acme.com'],
    ['WWW.acme.co.uk', 'acme.co.uk'],
    ['  http://acme.com:8080/x ', 'acme.com'],
    ['someone@acme.com', 'acme.com'],
  ])('%s -> %s', (raw, out) => expect(normalizeDomain(raw)).toBe(out));
  it.each(['localhost', '', 'a b.com', '-x.com', 'x..com', 'acme', '1.2.3.4', 'a.b'.repeat(100)])('rejects %j', (raw) =>
    expect(normalizeDomain(raw)).toBeNull());
});
