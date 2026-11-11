import { describe, it, expect } from 'vitest';
import { mxLookup, type Resolver } from '../src/engine/mx.js';

const err = (code: string) => Object.assign(new Error(code), { code });
const stub = (o: Partial<Resolver>): Resolver => ({
  resolveMx: async (d) => { if (d === 'google.com') return [{ exchange: 'mx.google.test', priority: 1 }]; throw err('ENODATA'); },
  resolve4: async () => { throw err('ENOTFOUND'); },
  ...o,
});

describe('mxLookup', () => {
  it('a resolver that says ENOTFOUND for everything (even google.com) -> dns_error, not no_mx', async () => {
    const liar: Resolver = { resolveMx: async () => { throw err('ENOTFOUND'); }, resolve4: async () => { throw err('ENOTFOUND'); } };
    expect(await mxLookup('gmail.com', liar)).toEqual({ error: 'dns_error' });
  });
  it('a healthy resolver still reports a genuinely missing domain as no_mx', async () => {
    const r = stub({ resolveMx: async (d) => { if (d === 'google.com') return [{ exchange: 'm', priority: 1 }]; throw err('ENOTFOUND'); } });
    expect(await mxLookup('nope-xyz.com', r)).toEqual({ error: 'no_mx' });
  });
  it('sorts MX hosts by ascending priority', async () => {
    const r = stub({ resolveMx: async () => [{ exchange: 'b.mx', priority: 20 }, { exchange: 'a.mx', priority: 10 }] });
    expect(await mxLookup('x.com', r)).toEqual({ hosts: ['a.mx', 'b.mx'] });
  });
  it('falls back to A record when no MX', async () => {
    expect(await mxLookup('x.com', stub({ resolve4: async () => ['1.2.3.4'] }))).toEqual({ hosts: ['x.com'] });
  });
  it('no MX and no A -> no_mx', async () => {
    expect(await mxLookup('x.com', stub({}))).toEqual({ error: 'no_mx' });
  });
  it('null MX (".") -> no_mx', async () => {
    expect(await mxLookup('x.com', stub({ resolveMx: async () => [{ exchange: '.', priority: 0 }] }))).toEqual({ error: 'no_mx' });
  });
  it.each(['ETIMEOUT', 'ESERVFAIL'])('%s -> dns_error', async (code) => {
    expect(await mxLookup('x.com', stub({ resolveMx: async () => { throw err(code); } }))).toEqual({ error: 'dns_error' });
  });
});
