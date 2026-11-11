import { describe, it, expect } from 'vitest';
import { mxLookup, type Resolver } from '../src/engine/mx.js';

const err = (code: string) => Object.assign(new Error(code), { code });
const stub = (o: Partial<Resolver>): Resolver => ({
  resolveMx: async () => { throw err('ENODATA'); },
  resolve4: async () => { throw err('ENOTFOUND'); },
  ...o,
});

describe('mxLookup', () => {
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
