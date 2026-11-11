import { describe, it, expect, afterEach } from 'vitest';
import { catchAllCheck, type ProbeOpts } from '../src/engine/smtp.js';
import { startFakeSmtp, type Behavior, type FakeSmtp } from './helpers/fakeSmtp.js';

let srv: FakeSmtp | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });
const run = async (b: Behavior, timeoutMs = 1000) => {
  srv = await startFakeSmtp(b);
  const opts: ProbeOpts = { port: srv.port, timeoutMs, helo: 't.local', mailFrom: 'v@t.local' };
  return catchAllCheck('127.0.0.1', 'acme.com', opts);
};

describe('catchAllCheck', () => {
  it('acceptAll -> catch_all', async () => expect(await run({ mode: 'acceptAll' })).toBe('catch_all'));
  it('rejectUnknown -> not_catch_all', async () => expect(await run({ mode: 'rejectUnknown', known: [] })).toBe('not_catch_all'));
  it('greylist -> unknown', async () => expect(await run({ mode: 'greylist' })).toBe('unknown'));
  it('drop -> unknown', async () => expect(await run({ mode: 'drop' })).toBe('unknown'));
  it('uses a different random bogus local part each call', async () => {
    srv = await startFakeSmtp({ mode: 'acceptAll' });
    const opts: ProbeOpts = { port: srv.port, timeoutMs: 1000, helo: 't.local', mailFrom: 'v@t.local' };
    await catchAllCheck('127.0.0.1', 'acme.com', opts);
    await catchAllCheck('127.0.0.1', 'acme.com', opts);
    expect(srv.rcpts).toHaveLength(2);
    expect(srv.rcpts[0]).not.toBe(srv.rcpts[1]);
    expect(srv.rcpts.every((r) => /^zz[0-9a-f]{12}@acme\.com$/.test(r))).toBe(true);
  });
});
