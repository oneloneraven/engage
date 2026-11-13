# Engage Plan 1: Platform, Feedback and Email Implementation Plan

> **Execution:** follow the repository's `docs/working-with-claude.md` (bootstrap ADRs 0003–0005).
> - The Opus-class main session owns the security-sensitive tasks, **Task 2** (Access guard), **Task 5** (reply-address signatures) and **Task 10** (App JWT and webhook signatures), and builds them itself. It also reviews every other task's diff and real test output before moving on, and does the final verification.
> - Every other task goes to **one Sonnet-class subagent at a time**, working in the main checkout with no worktrees (Raven: work is sequential, so worktrees cost more than they save), with a self-contained brief. Follow-ups go to the same subagent. There are no parallel workers and no sub-sessions.
> - **Task 1** runs through the bootstrap skill and its `bootstrap-executor`. The main session keeps repository creation and the initial push.
> - Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Engage's platform and its feedback and email module before the product launches, so that every One Lone Raven product submits to, and is answered from, one place.

**Architecture:** One Cloudflare Worker that routes strictly by host:
- `engage.oneloneraven.com`: the admin SPA and its API, behind Cloudflare Access, with the JWT re-verified so it fails closed.
- `engage-api.oneloneraven.com`: the public intake, testimonials feed and GitHub webhook.

Behind it:
- D1 holds all state, and R2 holds attachments.
- An `email()` handler takes inbound mail, and the `send_email` binding sends replies.
- A daily cron runs retention.

**Tech Stack:**
- Plain JavaScript with JSDoc, type-checked by `tsc`.
- Biome, Vitest with `@cloudflare/vitest-plugin`, and `valibot` for validation.
- `postal-mime` for parsing email.
- Vite for the admin SPA, WebdriverIO plus axe-core for e2e.
- wrangler, OpenTofu. All of this comes from bootstrap modules `core`, `js-toolchain`, `web-app` and `cloudflare-opentofu`.

**Spec:** `docs/superpowers/specs/2026-11-12-engage-design.md` (sections 1–5, 7 (message counts and "reply owed" only), 10, 11 step 1). Releases (§6), health (§8) and conformance (§9) are Plans 2–4. Migrating the products onto Engage (§5.7 steps 2–5) is a separate plan in each product repository.

## Global Constraints

- Hosts: admin `engage.oneloneraven.com`, public `engage-api.oneloneraven.com`. Admin routes return 404 on the public host, and public routes return 404 on the admin host.
- The admin host refuses every request unless the `Cf-Access-Jwt-Assertion` header verifies (signature, `aud` = `ACCESS_AUD`, `iss` = `https://<ACCESS_TEAM_DOMAIN>`, expiry). Missing configuration means refuse. Only `APP_ENV` `e2e`/`development` with `ADMIN_ACCESS_CHECK=off` skips the check.
- Discord messages carry only the kind, the product name and a link to `https://engage.oneloneraven.com/items/<id>`, with `allowed_mentions: { parse: [] }`. They never include submitted text, a subject, an email address or a name.
- Submitted text is never written to logs, and error responses never echo it back.
- Message length: 1–5,000 characters, counted in Unicode code points (`[...s].length`), after trimming and normalising CRLF to LF.
- Kinds: `issue`, `feedback`, `email`. Sources: `web`, `app`, `email`. Credit: `name`, `initials`, `anonymous`.
- Contact email is optional. A form without one must say it can't be answered: that's product copy, outside this repository.
- Retention: archived items deleted `retention_months` (default 12) after `archived_at`; unarchived items `retention_months` after `last_activity_at`; junk 30 days after `created_at`.
- GitHub issue drafts never contain the contact email, name, `accountRef` or `context`.
- Testimonial excerpts must be a faithful subsequence of the original: ellipsis trimming only.
- Every state-changing admin action writes one `audit_events` row, attributed to the Access identity's email.
- British English in all UI copy and docs. Professional register in docs, commits and PRs.

## Review Focus

1. **Malformed or hostile inbound email:** HTML-only bodies, quoted-printable, a forged or truncated `reply+` token, or a missing `From`. Expected: no exception. Forged tokens are rejected, a missing text body falls back to HTML converted to text, and the message is stored as junk rather than lost. Test in Task 7.
2. **Backticks, `@mentions` and HTML in a message:** the issue draft fences the message with a run longer than the longest backtick run, and the admin UI renders text, never HTML. Test in Task 10 (fence) and Task 13 (rendering).
3. **Duplicate or out-of-order GitHub webhooks:** `issues.closed` delivered twice, or `reopened` before `closed`. Expected: `reply_owed_at` is set once and cleared by `reopened`, regardless of order. Test in Task 10.
4. **Unicode at the limits:** a 5,000-emoji message is accepted, 5,001 is rejected, and an excerpt containing emoji passes the faithfulness check. Test in Task 4 and Task 11.
5. **Wrong-audience or expired Access JWT, or a CORS preflight from an unregistered origin:** expected 403 for the JWT, and the preflight answered without `Access-Control-Allow-Origin`. Test in Task 2 and Task 4.

---

## File Structure

```
src/
  worker.js                 fetch / email / scheduled entry; host routing
  lib/
    access.js               verifyAccessJwt (ported from CL server/lib/access.js)
    http.js                 json(), notFound(), forbidden(), cors helpers
    ids.js                  newId()
    text.js                 normaliseMessage(), codePointLength(), longestBacktickRun()
    hmac.js                 hmacHex(secret, data)
  registry.js               getProduct(), productForOrigin()
  audit.js                  recordAudit()
  discord.js                notifyNew()
  intake/
    submissions.js          handleSubmission()
    schema.js               submissionSchema, validateContext()
    turnstile.js            verifyTurnstile()
    accounts.js             handleAccountDelete()
  email/
    reply-address.js        makeReplyAddress(), parseReplyAddress()
    inbound.js              handleInboundEmail()
    outbound.js             sendReply()
  admin/
    router.js               admin API routes
    items.js                listItems(), getItem(), setFlags(), deleteItem(), counts()
  github/
    app.js                  installationToken(), createIssue(), dispatch()
    issue-draft.js          issueDraft()
    webhook.js              handleGithubWebhook()
  testimonials/
    excerpt.js              isFaithfulExcerpt()
    testimonials.js         createExcerpt(), approve(), withdraw(), publicFeed()
  retention.js              runRetention()
web/                        admin SPA (Vite root)
  index.html, main.js, api.js, pages/{home,inbox,item,junk}.js
migrations/0001_initial.sql
seeds/products.sql
scripts/import-legacy.mjs
test/                       mirrors src/; apply-migrations.js setup
e2e/                        admin.spec.js, accessibility.spec.js
infra/                      access.tf, dns.tf, storage.tf (D1, R2)
docs/adr/                   0002-…0005 (see Task 14)
```

---

### Task 1: Bootstrap the repository and adapt it to two subdomains

**Files:**
- Create (by bootstrap): the whole scaffold
- Modify: `wrangler.jsonc`, `infra/dns.tf`, `src/worker.js`, `test/worker.test.js`, `vitest.config.js`, `package.json`
- Create: `docs/superpowers/specs/2026-11-12-engage-design.md`, `docs/superpowers/plans/` (this plan)

**Interfaces:**
- Produces: `env` bindings used by every later task: `DB` (D1), `ATTACHMENTS` (R2), `EMAIL` (send_email), `INTAKE_WEB_LIMITER` and `INTAKE_APP_LIMITER` (ratelimits), `ASSETS`. Vars: `APP_ENV`, `ADMIN_HOST`, `PUBLIC_HOST`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_ACCESS_CHECK`. Secrets (set later, listed in `.dev.vars.example`): `TURNSTILE_SECRET_KEY`, `REPLY_ADDRESS_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, plus one `DISCORD_WEBHOOK_<SLUG>` per product. `ACCOUNT_SECRET_<SLUG>` is shared with each product's own Worker, so it lives in Cloudflare Secrets Store (beta) as a `secrets_store_secrets` binding: the value is read with `await env.ACCOUNT_SECRET_CL.get()`. If the vitest plugin can't emulate Secrets Store bindings, the tests bind a plain string and the code accepts either shape through one `readSecret(binding)` helper in `src/lib/secrets.js`.

- [ ] **Step 1:** Run the bootstrap skill in an empty `~/git/oneloneraven/engage`:
  - name `engage`, owner `oneloneraven`, visibility public;
  - modules `core`, `js-toolchain`, `web-app`, `cloudflare-opentofu`;
  - `zone_name` `oneloneraven.com`, `beta` **no**.
  - Stop at the module's apex warning, and change the plan so that **no apex record or apex route** is created.
- [ ] **Step 2:** In `infra/dns.tf`, replace the apex placeholder with proxied placeholder records for `engage` and `in`. In `wrangler.jsonc` production, set two routes: `engage.oneloneraven.com/*` and `engage-api.oneloneraven.com/*`. Add the bindings and vars above to **every** environment (the file's own comment says environments don't inherit). Add `"triggers": { "crons": ["17 3 * * *"] }`.
- [ ] **Step 3:** Add dev dependencies `@cloudflare/vitest-plugin`, and dependencies `valibot` and `postal-mime`. Replace `vitest.config.js` with a `workers` project using `cloudflareTest` (CL's pattern, `climbing-logbook/vitest.config.js`): the D1 migrations go in as `TEST_D1_MIGRATIONS`, `setupFiles: ["./test/apply-migrations.js"]`, and an `outboundService` that returns 599 for every host. Add a `node` project for `test/lib/**` and `scripts`.
- [ ] **Step 4:** Copy the approved spec to `docs/superpowers/specs/2026-11-12-engage-design.md` and this plan to `docs/superpowers/plans/`.
- [ ] **Step 5:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all exit 0, and the template's health test passes.
- [ ] **Step 6:** Commit with the message `Bootstrap Engage on two subdomains with D1, R2 and email bindings`, then open the PR through the project's process.

---

### Task 2: Host routing and the fail-closed Access guard

**Files:**
- Create: `src/lib/access.js`, `src/lib/http.js`
- Modify: `src/worker.js`
- Test: `test/routing.test.js`, `test/lib/access.test.js`

**Interfaces:**
- Produces:
  - `verifyAccessJwt(token: string, opts: { teamDomain: string, aud: string, fetchImpl?: typeof fetch, nowS?: number }) => Promise<{ email: string } | null>`
  - `adminIdentity(request: Request, env) => Promise<{ email: string } | null>`
  - `json(body: unknown, status?: number, headers?: HeadersInit) => Response`
  - `notFound() => Response`
  - `forbidden() => Response`
  - `worker.fetch` dispatches to `routeAdmin(request, env, ctx, identity)` (Task 9) and `routePublic(request, env, ctx)` (Tasks 4, 10, 11).

- [ ] **Step 1: Write the failing tests:**
  - `test/lib/access.test.js`, generating an RS256 key pair with WebCrypto and stubbing `fetchImpl` for `/cdn-cgi/access/certs`:
    - a valid token returns `{ email: "owner@example.test" }`
    - wrong `aud` → `null`
    - wrong `iss` → `null`
    - expired by 61 s → `null`
    - unknown `kid` → keys refetched once, then `null`
  - `test/routing.test.js`:
    - `GET https://engage.oneloneraven.com/api/items` with no header → 403
    - with `ACCESS_AUD` unset → 403, even with a valid token
    - `GET https://engage-api.oneloneraven.com/api/items` → 404
    - `GET https://engage.oneloneraven.com/v1/testimonials/cl` → 404
    - `GET https://other.example/` → 404
    - `/api/health` on either host → 200 JSON with `ok: true`
- [ ] **Step 2:** Run `pnpm test -- routing access`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Port CL's `server/lib/access.js`, changing it to return the claims' `email` instead of `true`. The only skip: `env.ADMIN_ACCESS_CHECK === "off"` with `APP_ENV` in `["e2e", "development"]` yields `{ email: "dev@localhost" }`. Route on `new URL(request.url).hostname` against `env.ADMIN_HOST` and `env.PUBLIC_HOST`. On the admin host, non-`/api/` paths serve `ASSETS` (the SPA), behind the same guard.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Route by host and refuse admin requests without a verified Access token`.

---

### Task 3: Schema, registry, ids and the audit log

**Files:**
- Create: `migrations/0001_initial.sql`, `seeds/products.sql`, `src/registry.js`, `src/audit.js`, `src/lib/ids.js`, `test/apply-migrations.js`
- Test: `test/registry.test.js`, `test/audit.test.js`

**Interfaces:**
- Produces:
  - `newId() => string`: 26 characters, time-sortable (a millisecond timestamp in Crockford base32, plus 80 random bits).
  - `getProduct(env, slug: string) => Promise<Product | null>`
  - `productForOrigin(env, origin: string) => Promise<Product | null>`
  - `recordAudit(env, e: { actor: string, action: string, targetType: string, targetId: string, detail?: object }) => Promise<void>`
  - The `Product` typedef in `src/registry.js` maps columns to camelCase: `slug`, `name`, `domains: string[]`, `issueRepo`, `siteRepo`, `siteDispatchEvent`, `discordSecret`, `emailDomain`, `emailAliases: string[]`, `retentionMonths`, `appDailyCap`, `contextSchema: Record<string, { maxLength: number }>`, `backupForwardTo: string | null`, `testimonialsEnabled: boolean`, `accountSecret`, `thanksUrl`.

- [ ] **Step 1: Write `migrations/0001_initial.sql`.** These tables and checks are the contract:

```sql
CREATE TABLE products (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, domains TEXT NOT NULL,           -- JSON array
  issue_repo TEXT NOT NULL, site_repo TEXT, site_dispatch_event TEXT,
  discord_secret TEXT NOT NULL, email_domain TEXT NOT NULL, email_aliases TEXT NOT NULL DEFAULT '["hello"]',
  retention_months INTEGER NOT NULL DEFAULT 12, app_daily_cap INTEGER NOT NULL DEFAULT 50,
  context_schema TEXT NOT NULL DEFAULT '{}', backup_forward_to TEXT,
  testimonials_enabled INTEGER NOT NULL DEFAULT 1, account_secret TEXT NOT NULL, thanks_url TEXT NOT NULL
);
CREATE TABLE items (
  id TEXT PRIMARY KEY, product TEXT NOT NULL REFERENCES products(slug),
  kind TEXT NOT NULL CHECK (kind IN ('issue','feedback','email')),
  source TEXT NOT NULL CHECK (source IN ('web','app','email')),
  subject TEXT, contact_email TEXT, contact_name TEXT,
  quote_consent INTEGER NOT NULL DEFAULT 0, credit TEXT CHECK (credit IN ('name','initials','anonymous')),
  source_page TEXT, section TEXT, app_version TEXT, context TEXT, account_ref TEXT, auth_result TEXT,
  junk INTEGER NOT NULL DEFAULT 0, suspected_spam INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
  read_at TEXT, archived_at TEXT, reply_owed_at TEXT, issue_number INTEGER, issue_url TEXT,
  created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), from_addr TEXT,
  body_text TEXT NOT NULL, body_html TEXT, rfc_message_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL, filename TEXT, content_type TEXT, size INTEGER NOT NULL
);
CREATE TABLE testimonials (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  product TEXT NOT NULL, excerpt TEXT NOT NULL, attribution TEXT NOT NULL,
  approved_at TEXT, withdrawn_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE blocklist (pattern TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT
);
CREATE INDEX items_inbox ON items (product, junk, archived_at, read_at, last_activity_at);
CREATE INDEX items_issue ON items (issue_number);
```

  The first message of every item is stored in `messages` (direction `in`), so a thread is always `messages` ordered by `created_at`. Item text lives there, not on `items`. Timestamps are ISO 8601 UTC strings.
- [ ] **Step 2:** Write `seeds/products.sql`. It inserts `cl` (Climbing Logbook) and `deaftly` (Deaftly):
  - `cl`: domains `climbinglogbook.com`, `beta.climbinglogbook.com`, `my.climbinglogbook.com`; issue repo `oneloneraven/climbing-logbook`; aliases `["hello","support"]`; context schema `{"reportedUsername":{"maxLength":64},"reportedEntryId":{"maxLength":64},"errorRef":{"maxLength":64}}`.
  - `deaftly`: domains `deaftly.com`; issue repo `oneloneraven/deaftly`; site repo `oneloneraven/deaftly-website`, dispatch event `testimonials-changed`.
  - Secret names: `DISCORD_WEBHOOK_CL`, `DISCORD_WEBHOOK_DEAFTLY`, `ACCOUNT_SECRET_CL`, `ACCOUNT_SECRET_DEAFTLY`.
  - `thanks_url` values: the products' existing thanks pages (`https://deaftly.com/feedback/thanks/`, and CL's equivalent route).
  - `test/apply-migrations.js` applies the migrations and then this seed.
- [ ] **Step 3: Write the failing tests:**
  - `getProduct(env, "cl")` returns `domains` as an array and `contextSchema.errorRef.maxLength === 64`
  - `getProduct(env, "nope")` → `null`
  - `productForOrigin(env, "https://beta.climbinglogbook.com")` → `cl`
  - `productForOrigin(env, "https://evil.example")` → `null`
  - `recordAudit` inserts one row with `detail` JSON-encoded
  - `newId()` called twice in the same millisecond is distinct, and ids sort lexically by creation time
- [ ] **Step 4:** Run `pnpm test -- registry audit`. Expected: FAIL.
- [ ] **Step 5:** Implement the three modules.
- [ ] **Step 6:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 7:** Commit with the message `Add the schema, product registry, ids and audit log`.

---

### Task 4: Public intake API

**Files:**
- Create: `src/intake/submissions.js`, `src/intake/schema.js`, `src/intake/turnstile.js`, `src/intake/accounts.js`, `src/lib/text.js`, `src/discord.js`
- Test: `test/intake.test.js`, `test/lib/text.test.js`, `test/discord.test.js`, `test/accounts.test.js`

**Interfaces:**
- Consumes: `getProduct`, `productForOrigin`, `newId`, `json`.
- Produces:
  - `normaliseMessage(s: string) => string`
  - `codePointLength(s: string) => number`
  - `longestBacktickRun(s: string) => number`
  - `verifyTurnstile(token: string, ip: string, env) => Promise<boolean>`
  - `notifyNew(env, product: Product, n: { kind: 'issue'|'feedback'|'email'|'reply', itemId: string }) => Promise<void>`
  - `handleSubmission(request, env, ctx) => Promise<Response>`: `POST /v1/submissions`, plus `OPTIONS` for CORS.
  - `handleAccountDelete(request, env, product, accountRef) => Promise<Response>`: `DELETE /v1/accounts/:product/:accountRef`.

- [ ] **Step 1: Write the failing tests** (stub `fetch` for Turnstile and Discord through the outbound service). JSON body cases:
  - valid web feedback with Turnstile passing → 201 `{ id }`. One `items` row and one `messages` row are stored, `quote_consent` matches, and Discord was called once with a body whose `content` contains `New feedback`, `Climbing Logbook` and `https://engage.oneloneraven.com/items/<id>`, and does **not** contain the message text or email;
  - form-encoded web submission → 303 to the product's `thanks_url`;
  - honeypot `hpx` filled → 303 or 201 as normal, nothing stored, no Discord call;
  - Turnstile fails → 400, and the body doesn't contain the submitted message;
  - `source: "app"` with no Turnstile token → 201;
  - unknown product → 400;
  - message of 5,000 emoji → 201; 5,001 → 400;
  - `context` with an unknown key → key dropped; a value over `maxLength` → 400;
  - app submissions over `appDailyCap` that day → 201 with `suspected_spam = 1` and **no** Discord call;
  - rate limiter returns `{ success: false }` → 429;
  - `OPTIONS` from `https://climbinglogbook.com` → 204 with `Access-Control-Allow-Origin: https://climbinglogbook.com`; from `https://evil.example` → 204 with no `Access-Control-Allow-Origin`.
  - `test/accounts.test.js`: `DELETE` with `Authorization: Bearer <ACCOUNT_SECRET_CL>` nulls `account_ref` on matching items → 204; wrong secret → 403.
- [ ] **Step 2:** Run `pnpm test -- intake text discord accounts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `schema.js` defines `submissionSchema` with valibot, mirroring CL's `server/api/submissions.js` patterns:
    - `product`, `kind` (`issue`|`feedback`), `source` (`web`|`app`), `message`
    - `contactEmail?`, `contactName?` (≤100), `quoteConsent?` (boolean), `credit?`
    - `sourcePage?` (≤500), `section?` (≤64), `appVersion?` (`^\d+\.\d+\.\d+$`)
    - `context?`, `accountRef?` (≤64), `turnstileToken?`, `hpx?`.
  - `quoteConsent` and `credit` are kept only when `kind === "feedback"`.
  - Rate-limit keys: `web:<CF-Connecting-IP>` on `INTAKE_WEB_LIMITER` (5/60 s), `app:<CF-Connecting-IP>` on `INTAKE_APP_LIMITER` (3/60 s).
  - Discord is called through `ctx.waitUntil`, and its failures are logged without content.
  - CORS allows only origins whose hostname is in the product's `domains`.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add the public intake API with Turnstile, rate limits and content-free Discord pings`.

---

### Task 5: Reply addresses

**Files:**
- Create: `src/email/reply-address.js`, `src/lib/hmac.js`
- Test: `test/lib/reply-address.test.js`

**Interfaces:**
- Produces:
  - `hmacHex(secret: string, data: string) => Promise<string>`
  - `makeReplyAddress(itemId: string, domain: string, secret: string) => Promise<string>`, returning `reply+<itemId>.<first 16 hex of HMAC-SHA256(secret, itemId)>@<domain>`
  - `parseReplyAddress(address: string, secret: string) => Promise<string | null>`, returning the item id, or null when the address is malformed or the signature doesn't match (compared in constant time).

- [ ] **Step 1: Write the failing tests:**
  - a round trip returns the id
  - one changed signature character → null
  - `reply+abc@x` (no dot) → null
  - matching is case-insensitive on the local part's prefix only
  - `hello@x` → null
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Sign reply addresses so replies can't be forged onto other items`.

---

### Task 6: Outbound replies

**Files:**
- Create: `src/email/outbound.js`
- Test: `test/outbound.test.js`

**Interfaces:**
- Consumes: `makeReplyAddress`, `newId`, `recordAudit`.
- Produces: `sendReply(env, item: { id, product, contactEmail, subject }, product: Product, text: string, actor: string) => Promise<{ messageId: string }>`. It throws `Error("no-contact")` when there's no contact email.

- [ ] **Step 1: Write the failing tests**, with a fake `env.EMAIL.send` that records its argument:
  - `from` is `"<Product name> <hello@<emailDomain>>"`
  - `to` is the contact email
  - `subject` is `Re: <subject>`, or `Re: Your <feedback|report> about <Product name>`
  - `text` is the given text
  - headers include `Reply-To: reply+…@<emailDomain>`, plus `In-Reply-To` and `References` set to the latest inbound `rfc_message_id` when there is one
  - a `messages` row is stored (direction `out`); `last_activity_at` is updated; `reply_owed_at` is cleared; one audit row `reply.sent`
  - no contact email → throws `no-contact` and sends nothing
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement with the Email Sending binding (`env.EMAIL.send({ from, to, subject, text, headers })`).
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Send replies from the product's own address, threaded to the item`.

---

### Task 7: Inbound email

**Files:**
- Create: `src/email/inbound.js`
- Modify: `src/worker.js` (add the `email` export)
- Test: `test/inbound.test.js`, with raw `.eml` fixtures in `test/fixtures/email/`

**Interfaces:**
- Consumes: `parseReplyAddress`, `getProduct`, `notifyNew`, `newId`.
- Produces: `handleInboundEmail(message: ForwardableEmailMessage, env, ctx) => Promise<void>`. Products are matched on the recipient's domain against `email_domain`.

- [ ] **Step 1: Write the failing tests**, using fake `message` objects (`from`, `to`, `headers`, `raw` stream, `setReject`, `forward`):
  - `hello@climbinglogbook.com` with DMARC pass → new `email` item: subject stored, a message row with the text body, `auth_result` JSON `{ spf, dkim, dmarc }` parsed from `Authentication-Results`, and a Discord ping;
  - `support@climbinglogbook.com` (alias) → the same;
  - DMARC fail → item with `junk = 1` and no Discord ping;
  - sender on the blocklist (exact address, or `@domain`) → `junk = 1`, no ping;
  - a valid `reply+<id>.<sig>@…` → message appended to that item, `read_at` cleared, `last_activity_at` updated, ping kind `reply`;
  - a forged `reply+` → `setReject("Address does not exist")`, nothing stored;
  - `nobody@climbinglogbook.com` → rejected;
  - HTML-only body → `body_text` is the HTML with tags stripped, and `body_html` is kept;
  - one attachment → written to R2 at `items/<itemId>/<attachmentId>`, with an `attachments` row;
  - `backupForwardTo` set → `message.forward(backupForwardTo)` called once;
  - missing `From` header → stored as junk, no throw.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement with `PostalMime.parse(message.raw)`. Messages over 25 MiB are already rejected by Email Routing, so there's no size check here.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Take inbound email and replies into Engage, with junk handling`.

---

### Task 8: Item operations

**Files:**
- Create: `src/admin/items.js`
- Test: `test/items.test.js`

**Interfaces:**
- Consumes: `recordAudit`.
- Produces:
  - `listItems(env, f: { product?: string, kind?: string, state?: 'new'|'open'|'archived'|'starred'|'junk'|'reply-owed', hasIssue?: boolean, q?: string, cursor?: string, limit?: number }) => Promise<{ items: ItemSummary[], next: string | null }>`
  - `getItem(env, id) => Promise<ItemDetail | null>`
  - `setFlags(env, id, change: { read?: boolean, starred?: boolean, archived?: boolean, junk?: boolean, replyOwed?: false }, actor) => Promise<void>`
  - `deleteItem(env, id, actor) => Promise<void>`
  - `counts(env) => Promise<{ new: number, open: number, replyOwed: number, byProduct: Record<string, { new: number, open: number }> }>`

  Definitions: **new** = `read_at IS NULL AND junk = 0 AND archived_at IS NULL`. **open** = `read_at IS NOT NULL AND archived_at IS NULL AND junk = 0`. **reply owed** = `reply_owed_at IS NOT NULL`. `ItemDetail` includes the thread (`messages`), attachments (metadata only) and testimonials. `q` matches `messages.body_text` and `items.subject` with `LIKE`.

- [ ] **Step 1: Write the failing tests:**
  - filters and the three counts against seeded items
  - each `setFlags` change sets or clears its timestamp and writes an audit row (`item.read`, `item.starred`, `item.archived`, `item.junk`, `item.reply-owed-dismissed`)
  - `deleteItem` removes the item, its messages, attachments (and their R2 objects) and testimonials; it writes audit `item.deleted` with only the id in `detail`; afterwards `getItem` → null
  - cursor pagination returns every item exactly once
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Testimonial cache purging and site rebuilds on delete come from Task 11's `withdrawAllForItem`, called here.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add inbox queries, flags, counts and hard delete`.

---

### Task 9: Admin API

**Files:**
- Create: `src/admin/router.js`
- Test: `test/admin-api.test.js`

**Interfaces:**
- Consumes: Task 8 functions, `sendReply`, `createIssue` and `issueDraft` (Task 10), and Task 11's testimonial functions.
- Produces: `routeAdmin(request, env, ctx, identity: { email }) => Promise<Response>`. Routes (all JSON):
  - `GET /api/items?…` → `listItems`
  - `GET /api/items/:id` → `getItem`, which also marks the item read (audited)
  - `PATCH /api/items/:id` body `{ read?, starred?, archived?, junk?, replyOwed? }` → `setFlags`
  - `DELETE /api/items/:id` → `deleteItem`
  - `POST /api/items/:id/replies` `{ text }` → `sendReply`; 409 `{ error: "no-contact" }` when there's no email
  - `GET /api/items/:id/issue-draft` → `issueDraft`
  - `POST /api/items/:id/issue` `{ repo, title, body, labels }` → `createIssue`
  - `POST /api/items/:id/testimonials` `{ excerpt }`
  - `POST /api/testimonials/:id/approve`, `POST /api/testimonials/:id/withdraw`
  - `POST /api/blocklist` `{ pattern }`
  - `GET /api/counts`

- [ ] **Step 1: Write the failing tests:**
  - one test per route for the happy path and its main refusal, run through `worker.fetch` on the admin host with `ADMIN_ACCESS_CHECK=off`
  - every mutating route produces an audit row whose `actor` is `dev@localhost`
  - unknown routes → 404
  - a non-JSON body → 400
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Expose the admin API behind the Access guard`.

---

### Task 10: GitHub App: issues and webhooks

**Files:**
- Create: `src/github/app.js`, `src/github/issue-draft.js`, `src/github/webhook.js`
- Test: `test/github.test.js`, `test/issue-draft.test.js`, `test/webhook.test.js`
- Create: `scripts/create-github-app.mjs`. It creates the App in one click through GitHub's manifest flow (Raven, D17), the same way bootstrap's `secrets.mjs release-app` does.
  - Name `oneloneraven-engage`, owned by the `oneloneraven` organisation.
  - The permissions and events from spec §4.3.
  - Webhook URL `https://engage-api.oneloneraven.com/v1/github/webhook`, with a generated webhook secret.
  - It stores the App id, private key and webhook secret in Proton Pass, then opens the install page (All repositories).
  - A `--set-worker-secrets` mode pipes them into `wrangler secret put` for production. Secrets never go to stdout.
  - Test the manifest builder: permissions, events and webhook URL.
- Doc: `docs/runbooks/github-app.md`: running the script, and how to rotate the key by hand.

**Interfaces:**
- Consumes: `longestBacktickRun`, `hmacHex`, `recordAudit`.
- Produces:
  - `installationToken(env, owner: string) => Promise<string>`: an RS256 App JWT signed with WebCrypto from the PKCS#8 `GITHUB_APP_PRIVATE_KEY`, then `POST /app/installations/:id/access_tokens`, cached until 5 minutes before expiry.
  - `createIssue(env, itemId, draft: { repo, title, body, labels }, actor) => Promise<{ number, url }>`: stores `issue_number` and `issue_url`, audit `issue.created`.
  - `dispatch(env, repo: string, eventType: string) => Promise<void>`: `POST /repos/:repo/dispatches`.
  - `issueDraft(item: ItemDetail, product: Product) => { repo, title, body, labels }`.
  - `handleGithubWebhook(request, env) => Promise<Response>`: `POST /v1/github/webhook` on the public host.

- [ ] **Step 1: Write the failing tests:**
  - `issueDraft`:
    - `repo` = `product.issueRepo`
    - `title` = the first line, truncated at 70 characters with `…`
    - labels `["bug"]` for `issue` and `["enhancement"]` for `feedback`
    - the body contains the message inside a fence of `max(4, longestRun + 1)` backticks with info string `text`, plus `App version:` and `Page or section:`
    - the body does **not** contain the contact email, contact name, `accountRef` or any `context` value (assert each)
  - Webhook:
    - a bad `X-Hub-Signature-256` → 401
    - `issues.closed` for a linked item with a contact email → `reply_owed_at` set
    - the same delivery twice → set once, timestamp unchanged
    - `reopened` → cleared
    - `reopened` arriving before `closed` → the final state follows the last event's `issue.state`
    - an item without a contact email → never flagged
    - an unrelated issue number → 204, no change
  - `createIssue`: given a stubbed GitHub API, it posts to `/repos/oneloneraven/climbing-logbook/issues` and stores number and URL.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Webhook state is driven by the payload's `issue.state` (not the event name) to make it idempotent and robust to ordering.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Create redacted GitHub issues from items and flag replies owed when they close`.

---

### Task 11: Testimonials

**Files:**
- Create: `src/testimonials/excerpt.js`, `src/testimonials/testimonials.js`
- Test: `test/excerpt.test.js`, `test/testimonials.test.js`

**Interfaces:**
- Consumes: `dispatch`, `recordAudit`, `newId`.
- Produces:
  - `isFaithfulExcerpt(original: string, excerpt: string) => boolean`
  - `createExcerpt(env, itemId, excerpt, actor) => Promise<{ id }>`. It throws `Error("no-consent")` when `quote_consent = 0` or the kind isn't `feedback`, and `Error("not-faithful")` when the excerpt fails the check.
  - `approve(env, id, actor)`, `withdraw(env, id, actor)`, `withdrawAllForItem(env, itemId, actor)`
  - `publicFeed(env, slug) => Promise<Response>`: `GET /v1/testimonials/:slug` on the public host.

- [ ] **Step 1: Write the failing tests:**
  - `isFaithfulExcerpt`:
    - an exact substring → true
    - `"I love it … works offline"` from `"I love it. Also, it works offline"` → true
    - a changed word → false
    - reordered segments → false
    - an emoji-containing segment → true
    - a leading or trailing `…` → true
  - The rule: split the excerpt on `…` (U+2026), or on `...`; trim each segment; each non-empty segment must appear in the original **in order** and without overlap.
  - Attribution follows `credit`: `name` → `contact_name`, falling back to `Anonymous` when it's empty; `initials` → first letters of up to two words with full stops (e.g. `J. S.`); `anonymous` → `Anonymous`.
  - The feed lists only approved, unwithdrawn quotes for the slug, as `[{ text, attribution, date }]`, newest first, with `Cache-Control: no-cache` and no ids. Sites read the feed only at build time, and a rebuild is dispatched right after approval or withdrawal. An edge cache would hand that rebuild stale data, so the feed isn't cached (Raven, D12).
  - `approve` and `withdraw` call `dispatch(env, siteRepo, siteDispatchEvent)` when `siteRepo` is set.
  - A product with `testimonials_enabled = 0` → the feed returns 404.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Add consented, faithful testimonials and a public feed per product`.

---

### Task 12: Retention cron

**Files:**
- Create: `src/retention.js`
- Modify: `src/worker.js` (add the `scheduled` export)
- Test: `test/retention.test.js`

**Interfaces:**
- Consumes: `deleteItem`.
- Produces: `runRetention(env, now: Date) => Promise<{ deleted: number }>`.

- [ ] **Step 1: Write the failing tests**, with items around each boundary (with `retention_months` 12, and one product set to 6):
  - archived 12 months + 1 day ago → deleted; 12 months − 1 day ago → kept
  - unarchived with `last_activity_at` 12 months + 1 day ago → deleted
  - junk 31 days old → deleted; 29 days → kept
  - per-product months respected
  - each deletion writes audit actor `system:retention`
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Month arithmetic is calendar months in UTC.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Delete items automatically once their retention period ends`.

---

### Task 13: Admin SPA

**Files:**
- Create: `web/index.html`, `web/main.js`, `web/api.js`, `web/pages/home.js`, `web/pages/inbox.js`, `web/pages/item.js`, `web/pages/junk.js`, `web/styles.css`
- Modify: `vite.config.js` (root `web`, out `dist`)
- Test: `e2e/admin.spec.js`, `e2e/accessibility.spec.js`

**Interfaces:**
- Consumes: the admin API from Task 9 only, through `web/api.js`.
- Produces: hash-free client routes `/`, `/inbox`, `/items/:id`, `/junk`. The Worker serves `index.html` for any non-`/api/` path on the admin host.

- [ ] **Step 1:** Use the `frontend-design` skill to set the visual direction before writing markup (spec §7: the wireframes were layout only). Record the choice in `docs/ui.md`.
- [ ] **Step 2: Write the failing e2e tests** against `wrangler dev --env e2e`, with seeded data and `ADMIN_ACCESS_CHECK=off`:
  - **Home:** the verdict reads `1 thing needs you` when one item owes a reply, otherwise `All green`. The "Needs you" list shows reply-owed items. Counts show New, Open and Reply owed, each linking to `/inbox?state=…`. There's one card per product with its new and open counts.
  - **Inbox:** the filters change the list, and opening an item marks it read.
  - **Item:**
    - a message containing `<img src=x onerror=alert(1)>` and `` ``` `` renders as literal text;
    - the reply composer is disabled with the reason "No contact email" when there's none;
    - sending a reply appends it to the thread;
    - "Create GitHub issue" opens the editable draft and creates it, after which the link shows;
    - the testimonial action is disabled with the reason "No consent to quote" when there's no consent; otherwise selecting text, then Save, then Approve shows it as approved;
    - archive, star and delete (with confirmation) work.
  - **Junk:** lists junk items; "Not junk" moves an item back.
  - **Accessibility:** axe finds no WCAG 2.2 AA violations on each page.
- [ ] **Step 3:** Run `pnpm test:e2e`. Expected: FAIL.
- [ ] **Step 4:** Implement the pages. Render all user content with `textContent`, never `innerHTML`. Show inbound `body_html` only inside an `<iframe sandbox>` (no `allow-scripts`) through `srcdoc`, and only after the user clicks "Show formatted".
- [ ] **Step 5:** Run `pnpm test:e2e && pnpm build`. Expected: PASS in Chromium and Firefox.
- [ ] **Step 6:** Commit with the message `Add the admin SPA: home, inbox, item and junk`.

---

### Task 14: Infrastructure, docs and legacy import

**Files:**
- Create: `infra/access.tf`, `infra/storage.tf`, `scripts/import-legacy.mjs`, `test/scripts/import-legacy.test.js`
- Docs: `docs/adr/0002-one-worker-two-hosts.md`, `0003-engage-owns-feedback-storage.md`, `0004-content-free-notifications.md`, `0005-signed-reply-addresses.md`, plus updates to `docs/privacy.md`, `docs/data-protection.md` and `docs/threat-model.md` (from core)

**Interfaces:**
- Produces: `transformLegacy(input: { clIssueReports: object[], clFeedback: object[], deaftlyIssues: object[] }) => { sql: string, count: number }`.

- [ ] **Step 1:** `infra/access.tf`:
  - a self-hosted Access application for `engage.oneloneraven.com`;
  - a policy allowing only `var.owner_email`, which is a tfvar and **never committed**;
  - `session_duration = "8h"`;
  - an identity provider that enforces MFA (Raven picks the provider when applying; the README documents that email one-time PIN alone isn't allowed);
  - outputs `aud`, which goes into `ACCESS_AUD`.
- [ ] **Step 2:** `infra/storage.tf`: the D1 database `engage`, the R2 bucket `engage-attachments`, and the ratelimit namespaces. Wire the ids into `wrangler.jsonc`.
- [ ] **Step 3: Write the failing test for `transformLegacy`:**
  - CL rows map `issue_reports` → kind `issue` and `feedback_submissions` → kind `feedback`, keeping `contact_email`, `source_page`, `section`, `app_version`, `read_at`, `archived_at` and `created_at`, with `source: "web"` and `account_ref` = `user_id`;
  - Deaftly issues map label `bug` → `issue` and `feedback` → `feedback`, with the message taken from inside the fenced block and the app version from the `App version:` line;
  - every message lands in `messages`;
  - the SQL uses parameter-free literals, with single quotes escaped by doubling;
  - running it twice doesn't duplicate rows (`INSERT OR IGNORE` with deterministic ids derived from the source ids).
- [ ] **Step 4:** Implement the script. It reads JSON files exported with `wrangler d1 execute … --json` and `gh issue list --json`, and writes `import.sql`. The runbook `docs/runbooks/legacy-import.md` gives the exact export commands.
- [ ] **Step 5:** Write the ADRs and update the core docs. The privacy doc names Cloudflare (Workers, D1, R2, Email Routing, Email Sending, Turnstile), GitHub (issues Raven creates) and Discord (content-free notifications) as processors, with the retention from Global Constraints.
- [ ] **Step 6:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`. Expected: all pass.
- [ ] **Step 7:** Commit with the message `Add Access, storage, the legacy import script and the decision records`.

---

## After Plan 1

These need Raven, and happen in order:
1. Workers Paid enabled.
2. The GitHub App created per `docs/runbooks/github-app.md`, and the secrets set.
3. `tofu apply`.
4. The first release deployed.
5. Product migration plans executed in `climbing-logbook`, `deaftly-website` and `deaftly`: switching to the Engage API, moving the MX to Email Routing with routes to the Engage Worker, onboarding Email Sending, removing the old code, and the privacy updates. The import runs during this step.
6. Plans 2 (releases), 3 (health and engagement) and 4 (conformance).
