import { promises as dns } from 'node:dns';

export interface Resolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
}
export type MxResult = { hosts: string[] } | { error: 'no_mx' | 'dns_error' };

const CANARIES = ['google.com', 'cloudflare.com'];
const healthyAt = new WeakMap<Resolver, number>();

/**
 * ENOTFOUND is ambiguous: a real NXDOMAIN, or a resolver that answers NXDOMAIN for everything (blocked or filtered DNS).
 * Before declaring "no mail server" we check the resolver can still resolve well-known domains.
 */
async function resolverHealthy(r: Resolver): Promise<boolean> {
  const t = healthyAt.get(r);
  if (t && Date.now() - t < 5 * 60_000) return true;
  for (const c of CANARIES) {
    try { if ((await r.resolveMx(c)).length) { healthyAt.set(r, Date.now()); return true; } } catch { /* try next */ }
  }
  return false;
}

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
    if (!NOT_FOUND.has(code(e))) return { error: 'dns_error' };
    return (await resolverHealthy(resolver)) ? { error: 'no_mx' } : { error: 'dns_error' };
  }
}
