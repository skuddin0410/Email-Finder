import { promises as dns } from 'node:dns';

export interface Resolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
}
export type MxResult = { hosts: string[] } | { error: 'no_mx' | 'dns_error' };

const NOT_FOUND = new Set(['ENODATA', 'ENOTFOUND']);
const code = (e: unknown) => (e as { code?: string }).code ?? '';

export const systemResolver: Resolver = { resolveMx: (d) => dns.resolveMx(d), resolve4: (d) => dns.resolve4(d) };

export async function mxLookup(domain: string, resolver: Resolver = systemResolver): Promise<MxResult> {
  try {
    const mx = await resolver.resolveMx(domain);
    const hosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter((h) => h && h !== '.');
    return hosts.length ? { hosts } : { error: 'no_mx' };
  } catch (e) {
    if (!NOT_FOUND.has(code(e))) return { error: 'dns_error' };
  }
  try {
    const a = await resolver.resolve4(domain);
    return a.length ? { hosts: [domain] } : { error: 'no_mx' };
  } catch (e) {
    return NOT_FOUND.has(code(e)) ? { error: 'no_mx' } : { error: 'dns_error' };
  }
}
