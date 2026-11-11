import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({ config });
app.listen({ port: config.port, host: '0.0.0.0' }).then(
  () => console.log(`email-finder listening on :${config.port} (SMTP port ${config.smtpPort})`),
  (e) => { console.error(e); process.exit(1); },
);
