// Vercel serverless entry: runs the Fastify app for every /api/* request (see vercel.json rewrites).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../server/src/app.js';
import { loadConfig } from '../server/src/config.js';

// Vercel blocks outbound port 25, so verification will report "unavailable"; keep timeouts short.
const app = buildApp({ config: loadConfig({ SMTP_TIMEOUT_MS: '3000', BULK_DEADLINE_MS: '40000', ...process.env }), trustProxy: true });

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await app.ready();
  app.server.emit('request', req, res);
}
