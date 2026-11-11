import { randomBytes } from 'node:crypto';
import net from 'node:net';

export interface ProbeOpts { port: number; timeoutMs: number; helo: string; mailFrom: string }
export type ProbeOutcome = 'accept' | 'reject' | 'temp' | 'unreachable';
export interface ProbeResult { outcome: ProbeOutcome; code?: number }

/** Mailbox-level rejection codes. Other 5xx (554 policy blocks, etc.) say nothing about the mailbox. */
const MAILBOX_REJECT = new Set([550, 551, 553]);

/**
 * RCPT TO handshake without sending a message: greeting, EHLO, MAIL FROM, RCPT TO, QUIT.
 * Never throws; any network trouble is reported as `unreachable`.
 */
export function smtpProbe(host: string, email: string, opts: ProbeOpts): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: opts.port });
    let buf = '';
    let done = false;
    let step: 'greeting' | 'ehlo' | 'mail' | 'rcpt' = 'greeting';

    const finish = (r: ProbeResult, quit = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (quit && sock.writable) sock.end('QUIT\r\n'); else sock.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ outcome: 'unreachable' }), opts.timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', () => finish({ outcome: 'unreachable' }));
    sock.on('close', () => finish({ outcome: 'unreachable' }));

    const onReply = (code: number) => {
      if (step === 'greeting') {
        if (code !== 220) return finish({ outcome: 'unreachable', code });
        step = 'ehlo'; sock.write(`EHLO ${opts.helo}\r\n`);
      } else if (step === 'ehlo') {
        if (code < 200 || code >= 300) return finish({ outcome: 'unreachable', code });
        step = 'mail'; sock.write(`MAIL FROM:<${opts.mailFrom}>\r\n`);
      } else if (step === 'mail') {
        if (code < 200 || code >= 300) return finish({ outcome: 'unreachable', code });
        step = 'rcpt'; sock.write(`RCPT TO:<${email}>\r\n`);
      } else {
        if (code >= 200 && code < 300) return finish({ outcome: 'accept', code }, true);
        if (code >= 400 && code < 500) return finish({ outcome: 'temp', code }, true);
        if (MAILBOX_REJECT.has(code)) return finish({ outcome: 'reject', code }, true);
        finish({ outcome: 'unreachable', code }, true);
      }
    };

    sock.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        const m = /^(\d{3})([ -])/.exec(line);
        if (m && m[2] === ' ') onReply(Number(m[1]));
      }
    });
  });
}

export type CatchAll = 'catch_all' | 'not_catch_all' | 'unknown';

/** Probe a random mailbox that cannot exist; if the server accepts it, every address will be accepted. */
export async function catchAllCheck(host: string, domain: string, opts: ProbeOpts, probe: typeof smtpProbe = smtpProbe): Promise<CatchAll> {
  const local = `zz${randomBytes(6).toString('hex')}`;
  const { outcome } = await probe(host, `${local}@${domain}`, opts);
  return outcome === 'accept' ? 'catch_all' : outcome === 'reject' ? 'not_catch_all' : 'unknown';
}
