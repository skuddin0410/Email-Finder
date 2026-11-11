import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = buildApp({ config, staticDir: existsSync(webDist) ? webDist : undefined });
app.listen({ port: config.port, host: '0.0.0.0' }).then(
  () => console.log(`email-finder listening on :${config.port} (SMTP port ${config.smtpPort})`),
  (e) => { console.error(e); process.exit(1); },
);
