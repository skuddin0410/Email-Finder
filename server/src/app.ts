import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { parseBulkCsv, type BulkOutcome } from './bulk.js';
import { DomainLimiter, findEmail } from './engine/findEmail.js';
import type { Resolver } from './engine/mx.js';
import type { smtpProbe } from './engine/smtp.js';
import { InputError, type FindInput } from './engine/types.js';

export interface AppDeps { config: Config; resolver?: Resolver; probe?: typeof smtpProbe; /** Optional hook to serve a built UI. Kept out of this module because @fastify/static is ESM-only and breaks the Vercel function bundle. */ staticPlugin?: (app: FastifyInstance) => void; allowPrivateHosts?: boolean; /** Trust X-Forwarded-For. Enable ONLY behind a reverse proxy you control (e.g. Vercel). */ trustProxy?: boolean }

const FIELDS: (keyof FindInput)[] = ['url', 'name', 'company', 'domain'];
function readBody(body: unknown): FindInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('invalid_input', 'Request body must be a JSON object');
  const out: FindInput = {};
  for (const k of FIELDS) {
    const v = (body as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string') throw new InputError('invalid_input', `"${k}" must be a string`);
    out[k] = v;
  }
  return out;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, trustProxy: deps.trustProxy ?? false });
  const limiter = new DomainLimiter(config.domainConcurrency);
  const engineDeps = { config, resolver: deps.resolver, probe: deps.probe, limiter, allowPrivateHosts: deps.allowPrivateHosts };

  // Registered before rate-limit so asset requests are not counted against the API limit.
  deps.staticPlugin?.(app);
  app.register(rateLimit, {
    max: config.rateLimitPerMin,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => Object.assign(new Error(`Rate limit exceeded, retry in ${ctx.after}`), { statusCode: 429, code: 'rate_limited' }),
  });
  app.register(multipart, { limits: { fileSize: 1_000_000, files: 1 } });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof InputError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err.code === 'rate_limited') return reply.status(429).send({ error: { code: 'rate_limited', message: err.message } });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong' } });
    return reply.status(status).send({ error: { code: 'bad_request', message: err.message } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  // Routes live in a child plugin so they load after rate-limit/multipart (onRoute hooks only see later routes).
  app.register(async (r) => {
  r.get('/api/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  r.post('/api/find', async (req) => findEmail(readBody(req.body), engineDeps));

  const bulkMax = Math.max(1, Math.floor(config.rateLimitPerMin / 6));
  r.post('/api/find/bulk', { config: { rateLimit: { max: bulkMax, timeWindow: '1 minute' } } }, async (req) => {
    if (!req.isMultipart()) throw new InputError('invalid_input', 'Upload a CSV as multipart/form-data field "file"');
    const file = await req.file();
    if (!file) throw new InputError('invalid_input', 'No file uploaded');
    let buf: Buffer;
    try { buf = await file.toBuffer(); } catch { throw new InputError('invalid_input', 'File too large (max 1 MB)'); }
    const { rows, errors } = parseBulkCsv(buf);

    const outcomes: BulkOutcome[] = errors.map((e) => ({ row: e.row, input: {}, error: e.message }));
    const deadline = Date.now() + config.bulkDeadlineMs;
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const { row, input } = rows[next++]!;
        if (Date.now() > deadline) { outcomes.push({ row, input, error: 'Skipped: bulk time limit reached, resubmit these rows' }); continue; }
        try { outcomes.push({ row, input, result: await findEmail(input, engineDeps) }); }
        catch (e) { outcomes.push({ row, input, error: e instanceof InputError ? e.message : 'Lookup failed' }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, rows.length) }, worker));
    return { rows: outcomes.sort((a, b) => a.row - b.row) };
  });

  });

  return app;
}
