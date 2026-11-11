# Email Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web app that finds and SMTP-verifies the likely work email for a LinkedIn URL or name + company/domain, with CSV bulk mode.

**Architecture:** npm-workspaces monorepo. `server/` holds a pure, dependency-injected engine (`parse → patterns → MX → catch-all → probe → score`) behind a Fastify API. `web/` is a React/Vite SPA. Every network seam (DNS resolver, SMTP port/host) is injectable so a fake SMTP server tests real protocol paths.

**Tech Stack:** TypeScript (strict, ESM), Node 20, Fastify, `@fastify/multipart`, `@fastify/rate-limit`, `csv-parse`, `smtp-server` (test only), React 18 + Vite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-email-finder-design.md`

## Global Constraints
- Statuses are exactly `valid | risky | unknown | invalid`; confidence is an integer 0–100.
- Catch-all domain: every candidate `risky`, confidence capped at 50.
- `valid` confidence 85–99 by pattern rank; `unknown` confidence max 40; `no_mx` ⇒ all `invalid`.
- Port 25 blocked ⇒ whole run `unknown` with reason `smtp_unreachable` (never `invalid`).
- Bulk CSV cap 200 rows; synchronous JSON response; no job queue.
- API errors: `{error:{code,message}}`; 400 invalid input, 422 unparseable URL, 429 rate limit.
- Env config with defaults: `PORT=3000`, `SMTP_PORT=25`, `SMTP_TIMEOUT_MS=8000`, `HELO_DOMAIN=localhost`, `MAIL_FROM=verify@localhost`, `RATE_LIMIT_PER_MIN=30`, `DOMAIN_CONCURRENCY=2`.
- No LinkedIn scraping; names come only from URL slug or typed input.
- Engine unit coverage ≥ 90%.

## Review Focus
1. Non-profile LinkedIn URLs (`/company/…`, `/in/` empty, `linkedin.com/feed`) → 422, not a garbage name.
2. Single-word names / missing last name → patterns still generated, no `undefined` in emails.
3. Names with accents, apostrophes, hyphens, suffixes (`José O'Brien-Núñez Jr.`) → clean ASCII local parts.
4. Domain given as full URL / with `www.` / uppercase / with trailing path → normalized; invalid domain → 400.
5. Malformed or hostile CSV (BOM, CRLF, quoted commas, blank rows, >200 rows, missing columns) → per-row errors, never a 500.

## File Structure
```
package.json                      workspaces: server, web
server/package.json, tsconfig.json, vitest.config.ts
server/src/engine/types.ts        shared types
server/src/engine/parseInput.ts
server/src/engine/domain.ts       normalizeDomain
server/src/engine/patterns.ts
server/src/engine/mx.ts
server/src/engine/smtp.ts         smtpProbe, catchAllCheck
server/src/engine/score.ts
server/src/engine/findEmail.ts    orchestrator + domain limiter
server/src/config.ts
server/src/app.ts                 buildApp(deps) Fastify factory
server/src/bulk.ts                CSV parsing/formatting
server/src/index.ts               entrypoint
server/src/smoke.ts               live-SMTP manual script
server/test/helpers/fakeSmtp.ts   configurable fake SMTP server
server/test/**/*.test.ts
web/…                             Vite React SPA
e2e/                              Playwright tests
README.md
```

---

### Task 1: Scaffold + shared types + `parseInput`

**Files:**
- Create: root `package.json`, `.gitignore`, `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/engine/types.ts`, `server/src/engine/parseInput.ts`
- Test: `server/test/parseInput.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type Status = 'valid'|'risky'|'unknown'|'invalid'`
  - `interface Person { first: string; last: string; domain?: string; companyName?: string }`
  - `interface FindInput { url?: string; name?: string; company?: string; domain?: string }`
  - `class InputError extends Error { code: 'invalid_input'|'unparseable_url'; status: 400|422 }`
- Produces (`parseInput.ts`): `parseInput(input: FindInput): Person` (throws `InputError`)

- [ ] **Step 1: Scaffold** workspaces, strict TS ESM, Vitest with v8 coverage; `npm install`; `npm test -w server` runs (no tests yet, passes with `--passWithNoTests`).
- [ ] **Step 2: Write failing tests** in `parseInput.test.ts`, table-driven, asserting `{first,last}` (lowercase, ASCII):
  - `https://www.linkedin.com/in/jane-doe-a1b2c3d4/` → jane / doe
  - `https://linkedin.com/in/john-smith` → john / smith
  - `https://ca.linkedin.com/in/jos%C3%A9-o%27brien-n%C3%BA%C3%B1ez-jr-12345/` → jose / obriennunez
  - `https://www.linkedin.com/in/madonna` → first `madonna`, last `''`
  - `{name:'Dr. Mary-Ann Van Der Berg PhD', domain:'acme.com'}` → mary-ann treated as `maryann`, last `vanderberg`
  - `{name:'  Ana  ', company:'Acme'}` → first `ana`, companyName `Acme`
  - 422 `unparseable_url` for `https://linkedin.com/company/acme`, `https://linkedin.com/in/`, `https://linkedin.com/feed`, `https://example.com/in/jane-doe`
  - 400 `invalid_input` for `{}`, `{name:''}`, `{url:'not a url'}` (non-URL string is 400, not 422)
- [ ] **Step 3: Run** `npm test -w server -- parseInput` → FAIL (module missing).
- [ ] **Step 4: Implement `parseInput`.** URL branch: host must end in `linkedin.com` and path `/in/<slug>`; strip trailing `-[a-z0-9]{6,}` ID segment only if it contains a digit; `decodeURIComponent`; split on `-`. Name branch: strip titles/suffixes (`dr|mr|mrs|ms|prof|jr|sr|ii|iii|phd|md|mba`), NFD-normalize and drop diacritics and apostrophes, first token = first, remaining joined = last; hyphen within a token is removed.
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat: scaffold server and parseInput`.

---

### Task 2: `normalizeDomain` + `generatePatterns`

**Files:**
- Create: `server/src/engine/domain.ts`, `server/src/engine/patterns.ts`
- Test: `server/test/domain.test.ts`, `server/test/patterns.test.ts`

**Interfaces:**
- Produces: `normalizeDomain(raw: string): string | null` (null if not a valid hostname with a dot)
- Produces: `interface Pattern { email: string; pattern: string; rank: number }` (rank 0 = most likely); `generatePatterns(first: string, last: string, domain: string): Pattern[]`

- [ ] **Step 1: Write failing tests.**
  - `normalizeDomain`: `'https://www.Acme.COM/about?x=1'`→`acme.com`; `'acme.com'`→`acme.com`; `'WWW.acme.co.uk'`→`acme.co.uk`; `'localhost'`, `''`, `'a b.com'`, `'-x.com'` → `null`.
  - `generatePatterns('jane','doe','acme.com')` returns exactly 12 unique emails in this order: `jane.doe`, `jane`, `jdoe`, `janed`, `jane_doe`, `doe.jane`, `j.doe`, `doe`, `janedoe`, `doej`, `jane-doe`, `doejane` (all `@acme.com`), ranks 0..11, `pattern` names `first.last`, `first`, `flast`, `firstl`, `first_last`, `last.first`, `f.last`, `last`, `firstlast`, `lastf`, `first-last`, `lastfirst`.
  - last `''` → only `first` (single entry, no `undefined`/empty local parts). first `'j'`, last `'d'` → deduped.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** both. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: domain normalization and pattern generation`.

---

### Task 3: `mxLookup`

**Files:** Create `server/src/engine/mx.ts`; Test `server/test/mx.test.ts`

**Interfaces:**
- Produces: `type Resolver = { resolveMx(d:string):Promise<{exchange:string;priority:number}[]>; resolve4(d:string):Promise<string[]> }`; `mxLookup(domain: string, resolver?: Resolver): Promise<{ hosts: string[] } | { error: 'no_mx' | 'dns_error' }>` (default resolver = `node:dns/promises`)

- [ ] **Step 1: Failing tests** with stub resolvers: MX sorted by ascending priority; ENODATA/ENOTFOUND on MX but A present → `{hosts:[domain]}`; both absent → `{error:'no_mx'}`; `ETIMEOUT`/`ESERVFAIL` → `{error:'dns_error'}`; null-MX (`exchange:'.'`) → `no_mx`.
- [ ] **Step 2–4:** run FAIL → implement → PASS. **Step 5: Commit** `feat: mx lookup`.

---

### Task 4: Fake SMTP server + `smtpProbe`

**Files:** Create `server/test/helpers/fakeSmtp.ts`, `server/src/engine/smtp.ts` (probe part); Test `server/test/smtpProbe.test.ts`

**Interfaces:**
- Produces (`fakeSmtp.ts`): `startFakeSmtp(b: Behavior): Promise<{ port: number; rcpts: string[]; close(): Promise<void> }>` where `Behavior = { mode: 'rejectUnknown'; known: string[] } | { mode: 'acceptAll' } | { mode: 'greylist' } | { mode: 'slow'; delayMs: number } | { mode: 'drop' }`. Uses `smtp-server` on an ephemeral port, no TLS/auth; `rejectUnknown` replies `550 5.1.1 user unknown` to RCPT not in `known`; `greylist` replies `451 4.7.1`; `drop` destroys the socket on connect; records every RCPT in `rcpts`.
- Produces (`smtp.ts`): `interface ProbeOpts { port: number; timeoutMs: number; helo: string; mailFrom: string }`; `type ProbeOutcome = 'accept'|'reject'|'temp'|'unreachable'`; `smtpProbe(host: string, email: string, opts: ProbeOpts): Promise<{ outcome: ProbeOutcome; code?: number }>`

- [ ] **Step 1: Failing tests** against fake server at `host='127.0.0.1'`: known address → `accept` code 250; unknown → `reject` 550; greylist → `temp` 451; slow (delay > `timeoutMs:200`) → `unreachable`; drop → `unreachable`; nothing listening (closed port) → `unreachable`. Also assert the probe never issues DATA (server saw only RCPT) and sends QUIT.
- [ ] **Step 2–4:** FAIL → implement `smtpProbe` with raw `node:net` (read multi-line replies, EHLO→MAIL FROM→RCPT TO→QUIT, overall timeout destroying socket) → PASS.
- [ ] **Step 5: Commit** `feat: smtp probe with fake server`.

---

### Task 5: `catchAllCheck`

**Files:** Modify `server/src/engine/smtp.ts`; Test `server/test/catchAll.test.ts`

**Interfaces:**
- Consumes: `smtpProbe`, `ProbeOpts`
- Produces: `catchAllCheck(host: string, domain: string, opts: ProbeOpts, probe?: typeof smtpProbe): Promise<'catch_all'|'not_catch_all'|'unknown'>` — probes a random `zz<12 random hex>@domain`; `accept`→`catch_all`, `reject`→`not_catch_all`, `temp`/`unreachable`→`unknown`.

- [ ] **Step 1: Failing tests** with fake server `acceptAll` → `catch_all`; `rejectUnknown` → `not_catch_all`; `greylist` → `unknown`; `drop` → `unknown`; two calls use different random local parts (inspect `rcpts`).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: catch-all detection`.

---

### Task 6: `scoreResult`

**Files:** Create `server/src/engine/score.ts`; Test `server/test/score.test.ts`

**Interfaces:**
- Produces: `interface Candidate { email: string; pattern: string; status: Status; confidence: number; reason: string }`; `scoreResult(args: { rank: number; outcome: ProbeOutcome | 'no_mx'; catchAll: 'catch_all'|'not_catch_all'|'unknown' }): { status: Status; confidence: number; reason: string }`

- [ ] **Step 1: Table-driven failing tests** for every Global Constraints rule: `no_mx`→invalid/0/`no_mx`; catch_all (any outcome except reject)→risky, confidence `min(50, 50-rank*3)` floor 5; accept+not_catch_all rank 0→valid 99, rank 11→valid ≥85; accept with catchAll `unknown` → `risky`, confidence max 60 (cannot confirm validity); reject→invalid/0/`mailbox_rejected`; temp→unknown ≤40 `greylisted`; unreachable→unknown ≤40 `smtp_unreachable`. Assert confidence is always an integer in 0–100 and monotonically non-increasing in `rank` for each branch.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: scoring rules`.

---

### Task 7: `findEmail` orchestrator

**Files:** Create `server/src/config.ts`, `server/src/engine/findEmail.ts`; Test `server/test/findEmail.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6
- Produces: `interface Config { smtpPort:number; smtpTimeoutMs:number; heloDomain:string; mailFrom:string; rateLimitPerMin:number; domainConcurrency:number; port:number }`; `loadConfig(env = process.env): Config`
- Produces: `interface FindResult { person: {first:string;last:string}; domain: string; catchAll: 'catch_all'|'not_catch_all'|'unknown'; verificationAvailable: boolean; results: Candidate[] }`
- Produces: `findEmail(input: FindInput, deps: { config: Config; resolver?: Resolver; probe?: typeof smtpProbe }): Promise<FindResult>`; throws only `InputError` (including 400 when no domain can be determined and company-only input is given). Results sorted `valid` first, then by confidence desc. Probes with concurrency `domainConcurrency`, stops probing further once a `valid` is found, and remaining candidates are returned as `unknown` with reason `not_probed`. If catch-all detected, skips per-candidate probes. If every probe is `unreachable`, `verificationAvailable=false`.

- [ ] **Step 1: Failing tests** with fake server and a stub resolver mapping the domain to `127.0.0.1`: (a) `rejectUnknown` with `jane.doe@acme.com` known → top result `valid`, others invalid/not_probed, `catchAll:'not_catch_all'`; (b) `acceptAll` → all `risky`, ≤50; (c) no MX → all `invalid`; (d) `drop` → `verificationAvailable:false`, all `unknown`, reason `smtp_unreachable`; (e) probe concurrency never exceeds `domainConcurrency` (instrumented stub probe); (f) one probe throwing does not throw out of `findEmail`; (g) company-only input → 400 `InputError`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Run coverage** `npm run coverage -w server`, expect ≥90% on `src/engine`. **Step 6: Commit** `feat: findEmail orchestrator`.

---

### Task 8: Fastify API (single + bulk + rate limit)

**Files:** Create `server/src/app.ts`, `server/src/bulk.ts`, `server/src/index.ts`; Test `server/test/api.test.ts`, `server/test/bulk.test.ts`

**Interfaces:**
- Consumes: `findEmail`, `loadConfig`, `InputError`
- Produces: `buildApp(deps: { config: Config; resolver?: Resolver; probe?: typeof smtpProbe }): FastifyInstance`; `parseBulkCsv(buf: Buffer): { rows: FindInput[]; errors: {row:number; message:string}[] }` (throws `InputError` if >200 data rows or no recognized columns); `toResultsCsv(rows: {input: FindInput; result?: FindResult; error?: string}[]): string`
- Routes: `GET /api/health` → `{ok:true}`; `POST /api/find`; `POST /api/find/bulk` (multipart field `file`) → `{ rows:[{row, input, result?, error?}] }`. Rate limit `rateLimitPerMin` per IP via `@fastify/rate-limit` returns `{error:{code:'rate_limited',…}}` with 429.

- [ ] **Step 1: Failing tests** via `app.inject`: single success with stub `probe`; 400 for `{}`; 422 for company LinkedIn URL; 429 after limit+1 requests; health ok; bulk: good rows, one bad row → row error while others succeed, 201 rows → 400, BOM + CRLF + quoted comma (`"Smith, Jr"`) parse, blank rows skipped, missing columns → 400, non-CSV upload → 400. Error body shape always `{error:{code,message}}`; an unexpected thrown error becomes 500 with the same shape and no stack.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: http api and bulk csv`.

---

### Task 9: Web UI

**Files:** Create `web/package.json`, `web/vite.config.ts` (dev proxy `/api`→`:3000`), `web/index.html`, `web/src/{main.tsx,App.tsx,api.ts,SingleLookup.tsx,BulkUpload.tsx,ResultCard.tsx,styles.css}`; Test `web/src/*.test.tsx` (Vitest + Testing Library + jsdom)

**Interfaces:**
- Consumes: HTTP API from Task 8.
- Produces: `findOne(body): Promise<FindResult>`, `findBulk(file: File): Promise<BulkResponse>`; both throw `ApiError {code,message}`.

- [ ] **Step 1: Failing component tests** with mocked `fetch`: submitting a LinkedIn URL renders best email, status badge, confidence, copy button (clipboard stub called); catch-all result shows warning text "catch-all"; `verificationAvailable:false` shows banner "verification unavailable"; API error shows message with `role="alert"`; inputs have labels; bulk tab uploads a file and offers a download link whose Blob is the results CSV; submit disabled while loading.
- [ ] **Step 2–4:** FAIL → implement (responsive, keyboard-operable, light/dark safe) → PASS; `npm run build -w web` succeeds.
- [ ] **Step 5: Commit** `feat: web ui`.

---

### Task 10: End-to-end, smoke script, README

**Files:** Create `e2e/playwright.config.ts`, `e2e/start.ts` (boots real server on an ephemeral port with `SMTP_PORT` pointing at an in-process fake SMTP and a stub resolver via env hook `TEST_RESOLVER_MAP`), `e2e/find.spec.ts`, `server/src/smoke.ts`, `README.md`

**Interfaces:** Consumes the built app. `npm run smoke -w server -- "Jane Doe" acme.com` prints the `FindResult` JSON using the real resolver and real port 25.

- [ ] **Step 1: Failing Playwright tests** (`--trace off`): single lookup for a known mailbox shows `valid`; catch-all domain shows risky + warning; dropped SMTP shows unavailable banner; CSV bulk with 3 rows (one malformed) returns a downloadable file with 2 results + 1 error row.
- [ ] **Step 2–4:** FAIL → wire `e2e/start.ts` and the env hook (`TEST_RESOLVER_MAP` honored only when `NODE_ENV=test`) → PASS.
- [ ] **Step 5: Write README** (setup, env vars, port-25 requirement, honest-limitations paragraph from the spec, legal note, running each test layer) and run the full suite: `npm test`, `npm run coverage -w server`, `npm run e2e`. Expect all green.
- [ ] **Step 6: Try the smoke script** here; expected `smtp_unreachable` (port 25 blocked); record the outcome in the README as "not verified in sandbox".
- [ ] **Step 7: Commit** `feat: e2e tests, smoke script, docs`.
