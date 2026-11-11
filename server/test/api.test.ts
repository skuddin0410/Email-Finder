import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Resolver } from '../src/engine/mx.js';
import type { smtpProbe } from '../src/engine/smtp.js';

const resolver: Resolver = { resolveMx: async () => [{ exchange: 'mx.test', priority: 1 }], resolve4: async () => [] };
const probe: typeof smtpProbe = async (_h, email) =>
  email === 'jane.doe@acme.com' ? { outcome: 'accept', code: 250 } : { outcome: 'reject', code: 550 };

let app: FastifyInstance;
let customProbe: typeof smtpProbe | undefined;
const make = (env: Record<string, string> = {}) => (app = buildApp({ config: loadConfig({ RATE_LIMIT_PER_MIN: '1000', ...env }), resolver, probe: customProbe ?? probe, allowPrivateHosts: true }));
afterEach(async () => { await app?.close(); customProbe = undefined; });

function multipart(content: string | Buffer, filename = 'in.csv', field = 'file') {
  const b = '----testboundary';
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

describe('POST /api/find', () => {
  it('returns the valid candidate for a LinkedIn URL + domain', async () => {
    make();
    const res = await app.inject({ method: 'POST', url: '/api/find', payload: { url: 'https://www.linkedin.com/in/jane-doe-1a2b3c/', domain: 'acme.com' } });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.results[0]).toMatchObject({ email: 'jane.doe@acme.com', status: 'valid' });
    expect(j.verificationAvailable).toBe(true);
  });
  it.each([
    [{}, 400], [{ name: 'Jane Doe' }, 400], [{ name: 5 }, 400], [{ name: 'Jane Doe', domain: 'not a domain' }, 400],
    [{ url: 'https://linkedin.com/company/acme', domain: 'acme.com' }, 422],
  ])('error for %j -> %i with {error:{code,message}}', async (payload, status) => {
    make();
    const res = await app.inject({ method: 'POST', url: '/api/find', payload });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
  });
  it('malformed JSON -> 400 same shape', async () => {
    make();
    const res = await app.inject({ method: 'POST', url: '/api/find', payload: '{bad', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBeTruthy();
  });
  it('resolver crash degrades to verification-unavailable, no leak', async () => {
    app = buildApp({ config: loadConfig({}), resolver: { resolveMx: () => { throw new TypeError('kaboom'); }, resolve4: async () => [] } });
    const res = await app.inject({ method: 'POST', url: '/api/find', payload: { name: 'Jane Doe', domain: 'acme.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().verificationAvailable).toBe(false);
    expect(res.body).not.toMatch(/kaboom|at .*\.ts/);
  });
  it('rate limits per IP with 429', async () => {
    make({ RATE_LIMIT_PER_MIN: '3' });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: 'POST', url: '/api/find', payload: {} })).statusCode);
    expect(codes).toEqual([400, 400, 400, 429]);
    const res = await app.inject({ method: 'POST', url: '/api/find', payload: {} });
    expect(res.json().error.code).toBe('rate_limited');
  });
});

describe('GET /api/health', () => {
  it('ok and never rate limited', async () => {
    make({ RATE_LIMIT_PER_MIN: '1' });
    for (let i = 0; i < 3; i++) expect((await app.inject({ url: '/api/health' })).json()).toEqual({ ok: true });
  });
});

describe('POST /api/find/bulk', () => {
  it('processes good rows and reports row-level errors without failing the batch', async () => {
    make();
    const csv = 'name,domain\nJane Doe,acme.com\nBad Domain,not a domain\n,\nAnn Lee,acme.com\n';
    const res = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart(csv) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as { row: number; result?: { results: { status: string }[] }; error?: string }[];
    expect(rows.map((r) => r.row)).toEqual([2, 3, 5]);
    expect(rows[0]!.result!.results[0]!.status).toBe('valid');
    expect(rows[1]!.error).toMatch(/domain/i);
    expect(rows[2]!.result).toBeTruthy();
  });
  it('merges parse-time row errors (no url/name) into the response in row order', async () => {
    make();
    const res = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart('name,domain\nJane Doe,acme.com\n,acme.com\n') });
    const rows = res.json().rows;
    expect(rows.map((r: { row: number }) => r.row)).toEqual([2, 3]);
    expect(rows[1].error).toMatch(/url or name/i);
  });
  it('201 rows -> 400', async () => {
    make();
    const csv = 'name,domain\n' + Array.from({ length: 201 }, (_, i) => `Pa${i} Xb,acme.com`).join('\n');
    const res = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart(csv) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/200/);
  });
  it('missing columns, binary junk, and no file -> 400', async () => {
    make();
    expect((await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart('foo,bar\n1,2\n') })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart(Buffer.from([0, 255, 254, 1])) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/find/bulk', payload: {} })).statusCode).toBe(400);
  });
  it('stops starting new rows after the bulk deadline and says so per row', async () => {
    customProbe = async (_h, email) => { await new Promise((r) => setTimeout(r, 120)); return email === 'jane.doe@acme.com' ? { outcome: 'accept', code: 250 } : { outcome: 'reject', code: 550 }; };
    make({ BULK_DEADLINE_MS: '50', SMTP_TIMEOUT_MS: '1000' });
    const csv = 'name,domain\n' + Array.from({ length: 14 }, (_, i) => `Pa${i} Xb,acme.com`).join('\n');
    const res = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart(csv) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as { row: number; result?: unknown; error?: string }[];
    expect(rows).toHaveLength(14);
    expect(rows.some((r) => r.result)).toBe(true);
    const skipped = rows.filter((r) => r.error && /time limit/i.test(r.error));
    expect(skipped.length).toBeGreaterThan(0);
  });
  it('bulk has its own much lower rate limit', async () => {
    make({ RATE_LIMIT_PER_MIN: '6' });
    const ok = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart('name,domain\nJane Doe,acme.com\n') });
    const limited = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart('name,domain\nJane Doe,acme.com\n') });
    expect(ok.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('rate_limited');
  });
  it('BOM + CRLF file works end to end', async () => {
    make();
    const res = await app.inject({ method: 'POST', url: '/api/find/bulk', ...multipart('﻿Name,Domain\r\nJane Doe,acme.com\r\n') });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(1);
  });
});

describe('trustProxy (needed behind Vercel/any reverse proxy)', () => {
  const hit = (xff: string) => app.inject({ method: 'POST', url: '/api/find', payload: {}, headers: { 'x-forwarded-for': xff } });
  it('off by default: X-Forwarded-For cannot dodge the limit', async () => {
    app = buildApp({ config: loadConfig({ RATE_LIMIT_PER_MIN: '2' }) });
    const codes = [(await hit('1.1.1.1')).statusCode, (await hit('2.2.2.2')).statusCode, (await hit('3.3.3.3')).statusCode];
    expect(codes).toEqual([400, 400, 429]);
  });
  it('on: each real client IP gets its own bucket', async () => {
    app = buildApp({ config: loadConfig({ RATE_LIMIT_PER_MIN: '2' }), trustProxy: true });
    const codes = [(await hit('1.1.1.1')).statusCode, (await hit('2.2.2.2')).statusCode, (await hit('3.3.3.3')).statusCode, (await hit('3.3.3.3')).statusCode, (await hit('3.3.3.3')).statusCode];
    expect(codes).toEqual([400, 400, 400, 400, 429]);
  });
});
