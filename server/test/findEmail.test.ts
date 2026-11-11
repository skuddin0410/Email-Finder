import { describe, it, expect, afterEach } from 'vitest';
import { findEmail, DomainLimiter } from '../src/engine/findEmail.js';
import { loadConfig } from '../src/config.js';
import { InputError } from '../src/engine/types.js';
import { smtpProbe } from '../src/engine/smtp.js';
import type { Resolver } from '../src/engine/mx.js';
import { startFakeSmtp, type Behavior, type FakeSmtp } from './helpers/fakeSmtp.js';

let srv: FakeSmtp | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

const resolverTo = (host: string | null): Resolver => ({
  resolveMx: async () => { if (!host) throw Object.assign(new Error('x'), { code: 'ENODATA' }); return [{ exchange: host, priority: 1 }]; },
  resolve4: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); },
});
async function setup(b: Behavior, env: Record<string, string> = {}) {
  srv = await startFakeSmtp(b);
  const config = loadConfig({ SMTP_PORT: String(srv.port), SMTP_TIMEOUT_MS: '400', ...env });
  return { config, resolver: resolverTo('127.0.0.1'), limiter: new DomainLimiter(config.domainConcurrency) };
}
const input = { name: 'Jane Doe', domain: 'acme.com' };

describe('loadConfig', () => {
  it('has the documented defaults', () => {
    expect(loadConfig({})).toEqual({ port: 3000, smtpPort: 25, smtpTimeoutMs: 8000, heloDomain: 'localhost', mailFrom: 'verify@localhost', rateLimitPerMin: 30, domainConcurrency: 2 });
  });
  it('reads overrides and ignores garbage numbers', () => {
    expect(loadConfig({ PORT: '8080', SMTP_PORT: 'abc' })).toMatchObject({ port: 8080, smtpPort: 25 });
  });
});

describe('findEmail', () => {
  it('finds the valid mailbox and ranks it first', async () => {
    const deps = await setup({ mode: 'rejectUnknown', known: ['jane.doe@acme.com'] });
    const r = await findEmail(input, deps);
    expect(r.catchAll).toBe('not_catch_all');
    expect(r.verificationAvailable).toBe(true);
    expect(r.results[0]).toMatchObject({ email: 'jane.doe@acme.com', status: 'valid' });
    expect(r.results.slice(1).every((c) => c.status === 'invalid' || c.reason === 'not_probed')).toBe(true);
    expect(r.person).toEqual({ first: 'jane', last: 'doe' });
    expect(r.results).toHaveLength(12);
  });
  it('catch-all domain -> every candidate risky, <=50, no per-candidate probes', async () => {
    const deps = await setup({ mode: 'acceptAll' });
    const r = await findEmail(input, deps);
    expect(r.catchAll).toBe('catch_all');
    expect(r.results.every((c) => c.status === 'risky' && c.confidence <= 50)).toBe(true);
    expect(srv!.rcpts).toHaveLength(1); // only the bogus catch-all probe
  });
  it('no MX -> all invalid', async () => {
    const config = loadConfig({});
    const r = await findEmail(input, { config, resolver: resolverTo(null) });
    expect(r.results.every((c) => c.status === 'invalid' && c.reason === 'no_mx')).toBe(true);
  });
  it('dns error -> all unknown, verification unavailable', async () => {
    const resolver: Resolver = { resolveMx: async () => { throw Object.assign(new Error('x'), { code: 'ETIMEOUT' }); }, resolve4: async () => [] };
    const r = await findEmail(input, { config: loadConfig({}), resolver });
    expect(r.verificationAvailable).toBe(false);
    expect(r.results.every((c) => c.status === 'unknown' && c.reason === 'dns_error')).toBe(true);
  });
  it('dropped SMTP -> verification unavailable, all unknown smtp_unreachable', async () => {
    const deps = await setup({ mode: 'drop' });
    const r = await findEmail(input, deps);
    expect(r.verificationAvailable).toBe(false);
    expect(r.results.every((c) => c.status === 'unknown' && c.reason === 'smtp_unreachable')).toBe(true);
  });
  it('never exceeds domainConcurrency simultaneous probes', async () => {
    const deps = await setup({ mode: 'rejectUnknown', known: [] }, { DOMAIN_CONCURRENCY: '2' });
    let cur = 0, max = 0;
    const probe: typeof smtpProbe = async (...a) => { cur++; max = Math.max(max, cur); try { return await smtpProbe(...a); } finally { cur--; } };
    await findEmail(input, { ...deps, probe });
    expect(max).toBeLessThanOrEqual(2);
    expect(max).toBeGreaterThan(0);
  });
  it('a throwing probe does not throw out of findEmail', async () => {
    const deps = await setup({ mode: 'acceptAll' });
    const probe: typeof smtpProbe = async () => { throw new Error('boom'); };
    const r = await findEmail(input, { ...deps, probe });
    expect(r.results.every((c) => c.status === 'unknown')).toBe(true);
  });
  it('company-only input -> 400 InputError', async () => {
    await expect(findEmail({ name: 'Jane Doe', company: 'Acme' }, { config: loadConfig({}) })).rejects.toMatchObject({ status: 400 });
    await expect(findEmail({ name: 'Jane Doe', company: 'Acme' }, { config: loadConfig({}) })).rejects.toBeInstanceOf(InputError);
  });
  it('invalid domain -> 400', async () => {
    await expect(findEmail({ name: 'Jane Doe', domain: 'not a domain' }, { config: loadConfig({}) })).rejects.toMatchObject({ status: 400 });
  });
  it('url input + domain works and single names yield one candidate', async () => {
    const deps = await setup({ mode: 'rejectUnknown', known: ['madonna@acme.com'] });
    const r = await findEmail({ url: 'https://www.linkedin.com/in/madonna', domain: 'https://www.acme.com/x' }, deps);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ email: 'madonna@acme.com', status: 'valid' });
  });
});
