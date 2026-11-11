// Boots the real app (API + built web UI) against in-process fake SMTP servers. Used only by Playwright.
import { buildApp } from '../server/src/app.js';
import { loadConfig } from '../server/src/config.js';
import type { Resolver } from '../server/src/engine/mx.js';
import { startFakeSmtp } from '../server/test/helpers/fakeSmtp.js';

const first = await startFakeSmtp({ mode: 'rejectUnknown', known: ['jane.doe@known.test', 'ann.lee@known.test'] }, { host: '127.0.0.1' });
const port = first.port; // same port on three loopback IPs, one per scenario
await startFakeSmtp({ mode: 'acceptAll' }, { host: '127.0.0.2', port });
await startFakeSmtp({ mode: 'drop' }, { host: '127.0.0.3', port });

const hosts: Record<string, string> = { 'known.test': '127.0.0.1', 'catchall.test': '127.0.0.2', 'down.test': '127.0.0.3' };
const resolver: Resolver = {
  resolveMx: async (d) => {
    const h = hosts[d];
    if (!h) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return [{ exchange: h, priority: 1 }];
  },
  resolve4: async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); },
};

const config = loadConfig({ SMTP_PORT: String(port), SMTP_TIMEOUT_MS: '1500', RATE_LIMIT_PER_MIN: '1000' });
const app = buildApp({ config, resolver, allowPrivateHosts: true, staticDir: new URL('../web/dist', import.meta.url).pathname });
await app.listen({ port: 4173, host: '127.0.0.1' });
console.log('e2e server ready on :4173');
