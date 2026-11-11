export interface Config {
  port: number; smtpPort: number; smtpTimeoutMs: number; heloDomain: string; mailFrom: string;
  rateLimitPerMin: number; domainConcurrency: number; bulkDeadlineMs: number;
}
const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isInteger(n) && n > 0 ? n : d; };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: num(env.PORT, 3000),
    smtpPort: num(env.SMTP_PORT, 25),
    smtpTimeoutMs: num(env.SMTP_TIMEOUT_MS, 8000),
    heloDomain: env.HELO_DOMAIN || 'localhost',
    mailFrom: env.MAIL_FROM || 'verify@localhost',
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 30),
    domainConcurrency: num(env.DOMAIN_CONCURRENCY, 2),
    bulkDeadlineMs: num(env.BULK_DEADLINE_MS, 120_000),
  };
}
