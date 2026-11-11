# Email Finder

Find and verify a work email from a **LinkedIn profile URL** (or a name) plus a **company domain**. Single lookups and CSV bulk (up to 200 rows). Built as an internal tool; modelled on tools like Mailmeteor's LinkedIn Email Finder.

## How it works
1. Parse the name from the URL slug (`linkedin.com/in/jane-doe-4b2c91a7` → jane / doe) or from typed input. **LinkedIn is never scraped.**
2. Generate 12 ranked address patterns (`first.last`, `first`, `flast`, …).
3. MX lookup (falls back to the A record).
4. Catch-all check: probe a random mailbox that cannot exist.
5. SMTP `RCPT TO` probe per candidate (EHLO → MAIL FROM → RCPT TO → QUIT; no message is ever sent).
6. Score each candidate: `valid | risky | unknown | invalid` plus a 0–100 confidence.

## Run it
```bash
npm install
npm run build            # builds the web UI into web/dist
npm run start -w server  # http://localhost:3000 (serves API; see note below)
```
For development run `npm run dev:server` and `npm run dev:web` (Vite proxies `/api` to :3000).

### Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `SMTP_PORT` | 25 | Port used for verification probes |
| `SMTP_TIMEOUT_MS` | 8000 | Per-probe timeout |
| `HELO_DOMAIN` | localhost | Name announced in EHLO. **Set to a real hostname you control** |
| `MAIL_FROM` | verify@localhost | Envelope sender for probes. **Use a real address on your domain** |
| `RATE_LIMIT_PER_MIN` | 30 | Requests per IP per minute |
| `DOMAIN_CONCURRENCY` | 2 | Simultaneous probes per target domain |

### Port 25 is required
Verification needs **outbound TCP port 25**. Many clouds (AWS, GCP, Azure, most PaaS) block it. If it is blocked, the app says **"Verification unavailable"** and returns unverified guesses (`unknown`, max 40 confidence) instead of false negatives. Use a VPS that allows port 25.

## API
- `POST /api/find` `{ "url"?, "name"?, "domain" }` → `{ person, domain, catchAll, verificationAvailable, results: [{ email, pattern, status, confidence, reason }] }`
- `POST /api/find/bulk` multipart field `file` (CSV with `url`, or `name` + `domain`) → `{ rows: [{ row, input, result?, error? }] }`
- `GET /api/health`
- Errors: `{ "error": { "code", "message" } }`; 400 invalid input, 422 unparseable LinkedIn URL, 429 rate limit.

A company *name* alone is not resolved to a domain; supply the domain.

## Tests
```bash
npm test                 # server (116) + web (9) unit/integration tests
npm run coverage         # engine coverage, threshold 90%
npm run e2e              # Playwright: real server + fake SMTP servers + browser
npm run smoke -w server -- "Jane Doe" acme.com   # MANUAL live check, needs port 25 + real DNS
```
Protocol tests run against an in-process fake SMTP server (accept, reject, catch-all, greylist, slow, dropped connection), so real handshake paths are exercised without touching the internet.

**Not verified in the build sandbox:** live DNS and live SMTP. That sandbox blocks outbound DNS/port 25, so `npm run smoke` there reports every domain as `no_mx`. Run the smoke script on your own host before relying on real-world results.

## Honest limitations
SMTP verification is probabilistic. Google Workspace, Microsoft 365 and many gateways accept every address (catch-all) or refuse probing; those come back `risky`/`unknown`. A result is `valid` only when the server confirms the mailbox and the domain is not catch-all. No tool can guarantee deliverability. Probing from an IP can affect its reputation; keep volumes modest.

## Responsible use
For legitimate outreach only. Comply with GDPR, CAN-SPAM, CASL and LinkedIn's terms. Rate limiting is built in so the tool is not suited to mass harvesting.
