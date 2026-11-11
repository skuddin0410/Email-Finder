# LinkedIn-style Email Finder — Design

## Intent
A web app for the owner and their team that, given a LinkedIn profile URL (or a name plus company/domain), finds the most likely work email and reports how confident the result is. Modelled on Mailmeteor's LinkedIn Email Finder. Internal use; no accounts, billing or credits.

**Success criteria**
- Single lookup returns a ranked list of candidate emails with status (`valid` / `risky` / `unknown` / `invalid`) and a 0–100 confidence in a few seconds.
- CSV bulk upload produces a downloadable results CSV.
- The engine is verified by automated tests, including a fake SMTP server that exercises real protocol paths.

**Out of scope (YAGNI)**: LinkedIn scraping or login, accounts, billing, a browser extension, third-party verification APIs, sending email.

**Assumptions (confirmed by user)**: names come only from the URL slug or typed input. Use is for legitimate outreach. Per-client rate limiting is on.

## Architecture
TypeScript monorepo, two packages:

- `server/` — Node 20, Fastify. Owns the engine and the API.
- `web/` — React + Vite single-page UI.
- Tests: Vitest (unit and integration), Playwright (end to end).

### Units (each independently testable)
| Unit | Does | Depends on |
|---|---|---|
| `parseInput` | Turns a LinkedIn URL or `{name, company/domain}` into `{first, last, domain?, companyName?}`. Strips the slug ID suffix (`-a1b2c3d4`), decodes percent-encoding, normalizes accents (NFD), handles hyphens, apostrophes, multi-word surnames, titles and suffixes (Dr, Jr, PhD), and rejects non-profile URLs. | none |
| `resolveDomain` | If only a company name is given, resolves a domain. Accepts a typed domain directly and normalizes it (`https://www.x.com/` → `x.com`). A company name alone resolves via a small injected lookup, which fails clearly if none is configured. | DNS |
| `generatePatterns` | Returns about 12 ranked candidates from `{first, last, domain}`: `first.last`, `first`, `flast`, `firstl`, `first_last`, `last.first`, `f.last`, `last`, `firstlast`, `lastf`, `first-last`, `lastfirst`. Dedupes and lowercases. Handles a missing last name. | none |
| `mxLookup` | Resolves MX hosts, sorted by priority. Falls back to the A record per RFC 5321. Returns `no_mx` if neither exists. | DNS (injectable) |
| `smtpProbe` | Opens a connection to the MX on a configurable port (default 25), then runs EHLO, MAIL FROM, RCPT TO and QUIT without sending a message. Maps 250 to accept, 550 to reject, 4xx to greylist/temp, and timeouts and refusals to unknown. | net (injectable port/host) |
| `catchAllCheck` | Probes a random bogus local part on the domain. If it is accepted, the domain is catch-all. | `smtpProbe` |
| `scoreResult` | Combines probe, catch-all and pattern rank into status and 0–100 confidence. | none |
| `findEmail` | The orchestrator. Parse, resolve, generate, MX, catch-all, probe candidates with bounded concurrency and early exit on the first confirmed `valid`, then score and rank. | all above |
| `rateLimiter` | Per-IP request limit and a per-domain probe concurrency/interval limit (protects the target MX and our reputation). | none |

### Scoring rules
- No MX / no A record: all candidates `invalid`, with reason `no_mx`.
- Domain is catch-all: every candidate is `risky`, ordered by pattern prior; confidence is capped at 50.
- Probe accepted and domain not catch-all: `valid`, confidence 85–99 depending on pattern rank.
- Probe rejected (5xx user unknown): `invalid`.
- Greylisted (4xx), timeout, connection blocked, or a provider that refuses probing: `unknown`, confidence from the pattern prior only (max 40).
- If port 25 is blocked, the whole run reports `unknown` with `smtp_unreachable` so the UI can say verification was unavailable rather than showing false negatives.

### API
- `POST /api/find` `{ url? , name?, company?, domain? }` → `{ person, domain, catchAll, results: [{email, status, confidence, pattern, reason}] }`
- `POST /api/find/bulk` multipart CSV, with columns `url` or `name,company/domain`. Capped at 200 rows, processed with bounded concurrency. Returns one synchronous JSON response (no job queue); the UI turns it into a downloadable CSV.
- `GET /api/health`
- Errors are JSON `{error: {code, message}}` with 400 for invalid input, 429 for rate limit and 422 for an unparseable URL.

### UI
- A single lookup form (URL or name+company), a result card with copy button, status badges and confidence, and the full candidate list.
- A CSV upload tab with a progress state and a download of the results.
- A clear banner when verification is unavailable.
- Responsive and accessible: labelled inputs, keyboard operable.

### Config
`PORT`, `SMTP_PORT` (25), `SMTP_TIMEOUT_MS`, `HELO_DOMAIN`, `MAIL_FROM`, `RATE_LIMIT_PER_MIN`, `DOMAIN_CONCURRENCY`. Defaults are safe and documented in the README.

## Error handling
Every network step has a timeout and its failure is converted into `unknown` with a reason, never a thrown 500. The orchestrator never throws for per-candidate failures. Input validation returns 400/422 with a specific message.

## Testing
1. **Unit** (Vitest): `parseInput` (about 25 URL/name edge cases), `generatePatterns`, `scoreResult` (table-driven over every rule above), and domain normalization.
2. **Protocol integration**: an in-process fake SMTP server (`smtp-server` package) with configurable behaviours (accept all, reject unknown users, catch-all, 4xx greylist, slow/timeout, drop connection). `smtpProbe`, `catchAllCheck` and `findEmail` run against it through the injectable port and an injected MX resolver.
3. **API integration**: Fastify `inject` tests for success, validation errors, rate limiting, bulk CSV (good rows, bad rows, over-cap).
4. **End to end** (Playwright): the UI against the real server wired to the fake SMTP server — single lookup, catch-all warning, unavailable-verification banner, CSV bulk round trip.
5. **Live smoke script** (`npm run smoke -- name domain`): not part of CI. It runs the real engine against real domains from a host that allows port 25. This sandbox probably blocks port 25, so it is documented as a manual check rather than claimed as tested.
6. Coverage target: 90% or more on engine units.

## Honest limitations (shown in README and UI)
SMTP verification is probabilistic. Google Workspace, Microsoft 365 and many gateways are catch-all or refuse RCPT probing. Results are `valid` only when the server confirms and the domain is not catch-all. No tool can guarantee deliverability.
