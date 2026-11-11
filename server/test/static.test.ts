import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

describe('static web app', () => {
  it('serves index.html at / and keeps JSON 404s under /api', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-static-'));
    writeFileSync(join(dir, 'index.html'), '<html>MARKER</html>');
    app = buildApp({ config: loadConfig({}), staticDir: dir });
    const root = await app.inject({ url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('MARKER');
    const miss = await app.inject({ url: '/api/nope' });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error.code).toBe('not_found');
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ ok: true });
  });
  it('without staticDir, / is a JSON 404', async () => {
    app = buildApp({ config: loadConfig({}) });
    expect((await app.inject({ url: '/' })).statusCode).toBe(404);
  });
});
