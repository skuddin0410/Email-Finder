import { describe, it, expect, afterEach } from 'vitest';
import { smtpProbe, type ProbeOpts } from '../src/engine/smtp.js';
import { startFakeSmtp, type Behavior, type FakeSmtp } from './helpers/fakeSmtp.js';

let srv: FakeSmtp | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });
const opts = (port: number, timeoutMs = 2000): ProbeOpts => ({ port, timeoutMs, helo: 'test.local', mailFrom: 'verify@test.local' });
const start = async (b: Behavior) => (srv = await startFakeSmtp(b));

describe('smtpProbe', () => {
  it('accepts a known mailbox (250)', async () => {
    const s = await start({ mode: 'rejectUnknown', known: ['jane@acme.com'] });
    expect(await smtpProbe('127.0.0.1', 'jane@acme.com', opts(s.port))).toEqual({ outcome: 'accept', code: 250 });
  });
  it('rejects an unknown mailbox (550)', async () => {
    const s = await start({ mode: 'rejectUnknown', known: [] });
    expect(await smtpProbe('127.0.0.1', 'x@acme.com', opts(s.port))).toEqual({ outcome: 'reject', code: 550 });
  });
  it('treats 451 as temp', async () => {
    const s = await start({ mode: 'greylist' });
    expect(await smtpProbe('127.0.0.1', 'x@acme.com', opts(s.port))).toEqual({ outcome: 'temp', code: 451 });
  });
  it('times out on a silent server -> unreachable', async () => {
    const s = await start({ mode: 'slow', delayMs: 3000 });
    expect((await smtpProbe('127.0.0.1', 'x@acme.com', opts(s.port, 200))).outcome).toBe('unreachable');
  });
  it('dropped connection -> unreachable', async () => {
    const s = await start({ mode: 'drop' });
    expect((await smtpProbe('127.0.0.1', 'x@acme.com', opts(s.port))).outcome).toBe('unreachable');
  });
  it('nothing listening -> unreachable', async () => {
    const s = await start({ mode: 'acceptAll' });
    const port = s.port; await s.close(); srv = undefined;
    expect((await smtpProbe('127.0.0.1', 'x@acme.com', opts(port))).outcome).toBe('unreachable');
  });
  it('never sends DATA and closes the session', async () => {
    const s = await start({ mode: 'acceptAll' });
    await smtpProbe('127.0.0.1', 'x@acme.com', opts(s.port));
    await new Promise((r) => setTimeout(r, 100));
    expect(s.rcpts).toEqual(['x@acme.com']);
    expect(s.dataSeen).toBe(0);
    expect(s.closed).toBe(1);
  });
});
