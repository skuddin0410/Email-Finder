import type { Config } from '../config.js';
import { normalizeDomain } from './domain.js';
import net from 'node:net';
import { isBlockedAddress, isBlockedHostname } from './hostGuard.js';
import { mxLookup, systemResolver, type Resolver } from './mx.js';
import { parseInput } from './parseInput.js';
import { generatePatterns } from './patterns.js';
import { scoreResult, type Candidate } from './score.js';
import { catchAllCheck, smtpProbe, type CatchAll, type ProbeOpts, type ProbeResult } from './smtp.js';
import { InputError, type FindInput } from './types.js';

export interface FindResult {
  person: { first: string; last: string };
  domain: string;
  catchAll: CatchAll;
  verificationAvailable: boolean;
  results: Candidate[];
}
export interface FindDeps { config: Config; resolver?: Resolver; probe?: typeof smtpProbe; limiter?: DomainLimiter; /** Tests only: allow probing loopback/private hosts. Never enable in production. */ allowPrivateHosts?: boolean }

/** Caps simultaneous SMTP probes per target domain, shared across concurrent requests. */
export class DomainLimiter {
  private active = new Map<string, number>();
  private waiters = new Map<string, (() => void)[]>();
  constructor(private max: number) {}
  async run<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    while ((this.active.get(domain) ?? 0) >= this.max) await new Promise<void>((r) => this.waiters.set(domain, [...(this.waiters.get(domain) ?? []), r]));
    this.active.set(domain, (this.active.get(domain) ?? 0) + 1);
    try { return await fn(); } finally {
      this.active.set(domain, (this.active.get(domain) ?? 1) - 1);
      this.waiters.get(domain)?.shift()?.();
    }
  }
}

/** Returns a vetted public IPv4 to connect to, or null if the host is (or resolves to) anything internal. */
async function vetHost(host: string, resolver: Resolver): Promise<string | null> {
  if (net.isIP(host)) return isBlockedAddress(host) ? null : host;
  if (isBlockedHostname(host)) return null;
  let ips: string[];
  try { ips = await resolver.resolve4(host); } catch { return null; }
  if (!ips.length || ips.some(isBlockedAddress)) return null;
  return ips[0]!;
}

export async function findEmail(input: FindInput, deps: FindDeps): Promise<FindResult> {
  const { config } = deps;
  const person = parseInput(input);
  if (!person.domain) throw new InputError('invalid_input', 'A company domain is required (e.g. acme.com); company names alone cannot be resolved');
  const domain = normalizeDomain(person.domain);
  if (!domain) throw new InputError('invalid_input', `"${person.domain}" is not a valid domain`);

  const patterns = generatePatterns(person.first, person.last, domain);
  const base = { person: { first: person.first, last: person.last }, domain };
  const mk = (p: (typeof patterns)[number], c: Omit<Candidate, 'email' | 'pattern'>): Candidate => ({ email: p.email, pattern: p.pattern, ...c });

  const mx = await mxLookup(domain, deps.resolver);
  if ('error' in mx) {
    if (mx.error === 'no_mx')
      return { ...base, catchAll: 'unknown', verificationAvailable: true, results: patterns.map((p) => mk(p, { ...scoreResult({ rank: p.rank, outcome: 'no_mx', catchAll: 'unknown' }) })) };
    return { ...base, catchAll: 'unknown', verificationAvailable: false, results: patterns.map((p) => mk(p, { status: 'unknown', confidence: 0, reason: 'dns_error' })) };
  }

  let host: string | null = null;
  if (deps.allowPrivateHosts) host = mx.hosts[0]!;
  else for (const h of mx.hosts) { host = await vetHost(h, deps.resolver ?? systemResolver); if (host) break; }
  if (!host)
    return { ...base, catchAll: 'unknown', verificationAvailable: false, results: patterns.map((p) => mk(p, { status: 'unknown', confidence: 0, reason: 'blocked_host' })) };
  const opts: ProbeOpts = { port: config.smtpPort, timeoutMs: config.smtpTimeoutMs, helo: config.heloDomain, mailFrom: config.mailFrom };
  const limiter = deps.limiter ?? new DomainLimiter(config.domainConcurrency);
  const rawProbe = deps.probe ?? smtpProbe;
  const probe: typeof smtpProbe = (h, e, o) =>
    limiter.run(domain, async () => { try { return await rawProbe(h, e, o); } catch { return { outcome: 'unreachable' } as ProbeResult; } });

  const catchAll = await catchAllCheck(host, domain, opts, probe);
  const unreachableAll = (): FindResult => ({
    ...base, catchAll, verificationAvailable: false,
    results: patterns.map((p) => mk(p, scoreResult({ rank: p.rank, outcome: 'unreachable', catchAll: 'unknown' }))),
  });

  if (catchAll === 'catch_all')
    return { ...base, catchAll, verificationAvailable: true, results: sort(patterns.map((p) => mk(p, scoreResult({ rank: p.rank, outcome: 'accept', catchAll })))) };

  const outcomes = new Map<number, ProbeResult>();
  let next = 0;
  let found = false;
  const probeOne = async (i: number) => { outcomes.set(i, await probe(host, patterns[i]!.email, opts)); if (outcomes.get(i)!.outcome === 'accept') found = true; };

  if (catchAll === 'unknown' && patterns.length) {
    // Cheap reachability gate: if the first real candidate cannot even be probed, don't burn a timeout per pattern.
    await probeOne(0); next = 1;
    if (outcomes.get(0)!.outcome === 'unreachable') return unreachableAll();
  }
  const worker = async () => {
    while (!found && next < patterns.length) await probeOne(next++);
  };
  await Promise.all(Array.from({ length: Math.min(config.domainConcurrency, Math.max(1, patterns.length)) }, worker));

  const attempted = [...outcomes.values()];
  const verificationAvailable = !(attempted.length > 0 && attempted.every((o) => o.outcome === 'unreachable'));
  const results = patterns.map((p) => {
    const o = outcomes.get(p.rank);
    return mk(p, scoreResult({ rank: p.rank, outcome: o ? o.outcome : 'not_probed', catchAll }));
  });
  return { ...base, catchAll, verificationAvailable, results: sort(results) };
}

const weight = (c: Candidate) => (c.status === 'valid' ? 2 : c.status === 'risky' ? 1 : 0);
function sort(cs: Candidate[]): Candidate[] {
  return cs.map((c, i) => ({ c, i })).sort((a, b) => weight(b.c) - weight(a.c) || b.c.confidence - a.c.confidence || a.i - b.i).map((x) => x.c);
}
