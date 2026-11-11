import net from 'node:net';
import { SMTPServer } from 'smtp-server';

export type Behavior =
  | { mode: 'rejectUnknown'; known: string[] }
  | { mode: 'acceptAll' }
  | { mode: 'greylist' }
  | { mode: 'slow'; delayMs: number }
  | { mode: 'drop' };

export interface FakeSmtp { port: number; rcpts: string[]; dataSeen: number; closed: number; close(): Promise<void> }

const listen = (srv: { listen(p: number, h: string, cb: () => void): unknown }, addr: () => unknown) =>
  new Promise<number>((res) => srv.listen(0, '127.0.0.1', () => res((addr() as net.AddressInfo).port)));

export async function startFakeSmtp(b: Behavior): Promise<FakeSmtp> {
  const state = { rcpts: [] as string[], dataSeen: 0, closed: 0 };

  if (b.mode === 'drop' || b.mode === 'slow') {
    const sockets = new Set<net.Socket>();
    const srv = net.createServer((s) => {
      sockets.add(s);
      s.on('error', () => {});
      if (b.mode === 'drop') s.destroy();
      else setTimeout(() => s.writable && s.write('220 slow ready\r\n'), b.delayMs);
    });
    const port = await listen(srv, () => srv.address());
    return { port, ...state, close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); srv.close(() => r()); }) } as FakeSmtp;
  }

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onRcptTo(address, _s, cb) {
      state.rcpts.push(address.address.toLowerCase());
      if (b.mode === 'greylist') return cb(Object.assign(new Error('4.7.1 Greylisted, try later'), { responseCode: 451 }));
      if (b.mode === 'rejectUnknown' && !b.known.map((k) => k.toLowerCase()).includes(address.address.toLowerCase()))
        return cb(Object.assign(new Error('5.1.1 User unknown'), { responseCode: 550 }));
      cb();
    },
    onData(stream, _s, cb) { state.dataSeen++; stream.resume(); stream.on('end', () => cb()); },
    onClose() { state.closed++; },
  });
  const port = await listen(server, () => server.server.address());
  const handle: FakeSmtp = {
    port,
    get rcpts() { return state.rcpts; },
    get dataSeen() { return state.dataSeen; },
    get closed() { return state.closed; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  return handle;
}
