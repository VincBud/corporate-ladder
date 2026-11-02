# Closed Alpha Launch Readiness Audit

**Scope:** first external closed alpha (5–10 invited testers, 7 days, testers in Germany/EU).
**Audited:** branch `corporate-progression` at `7ad3e55`, plus the audit fixes listed below (uncommitted).
**Date:** 2026-11-02.
**Environment:** the only Supabase project is **staging** (eu-central-1). Nothing is deployed.

Everything below was checked in this audit run unless it's marked otherwise. "Not verified" means exactly that.

---

## Executive summary

**The application is ready for an alpha; the operation around it is not yet.**

**Product:**
- Gameplay, verified scoring, careers, achievements, Daily Challenges, onboarding and feedback all work end to end on staging.
- That includes fresh guest, registered and returning-player journeys on desktop and mobile (Chromium).
- Database security held up under direct attack attempts: row-level security, privilege allowlist, append-only ledgers, seed and answer protection.
- No critical code vulnerability was found.

**Fixed during this audit** (small, isolated, verified):
- No error boundaries: one malformed response blanked the whole desktop.
- No HTTP security headers: no clickjacking protection, `X-Powered-By` exposed.
- Cross-site writes to the API were accepted.
- Two flaky simulation tests.

**Not ready to invite testers yet.** Four blockers are operational or legal, not code:
1. No production environment exists: no host, and no Supabase project separate from staging.
2. Confirmation and password-reset email has never been verified, and almost certainly won't reach external addresses with Supabase's default mailer.
3. There is no privacy notice identifying the data controller, as required when collecting EU testers' data.
4. Redirect URLs aren't configured for any hosted domain.

**Recommendation: CONDITIONAL GO.** Launch once the four blockers are resolved; the checklist below lists the steps in order.

---

## Readiness scorecard

| Area | Status | Evidence |
|---|---|---|
| Gameplay | **Pass** | 214/214 browser checks, including 27 full-journey checks (guest A1–A10, registered B1–B13, returning C on desktop and mobile); 632/632 unit and integration tests |
| Authentication | **Blocked** | Sign-in, refresh persistence, sign-out and sign-in again pass. Sign-up confirmation and password-reset email were **not verified** (no test inbox) and most likely fail for external addresses (H1). Redirect URLs aren't set for a hosted domain (H4) |
| Security | **Conditional** | No critical findings; 3 medium findings fixed; residual items M1–M6 below. 59/59 live tests on real Supabase (RLS, grants, direct writes, cross-account access, concurrency, deadlines, replay) |
| Data integrity | **Pass** | All 10 integrity counters are 0 on staging after the run; all 9 local migrations match staging; append-only guards and account-deletion cascades are tested |
| Performance | **Pass** | Measured: page load 47 ms on localhost; median API latency 6–165 ms to staging; 339 KB gzip client JS; benchmarks well within alpha volume |
| Privacy/legal | **Blocked** | No privacy notice or controller identity (H3); no deletion process published (M4); Impressum needs a legal decision |
| Deployment | **Blocked** | No host, no production project, no monitoring (H2, M6) |
| UX/onboarding | **Pass** | Orientation, first assignment, department timing and survey behave as designed. Minor friction is listed under "Can wait" |
| Feedback collection | **Pass** | Guest and account submissions, idempotency, privacy, report script; 32/32 browser and 4/4 live checks |

---

## Findings

Severity reflects risk for a 5–10 person invite-only alpha.

### High

**H1 · Confirmation and password-reset email can't be assumed to work** · Launch blocker: **Yes**
- **Affected:** Supabase Auth email (sign-up confirmation, password recovery, resend).
- **Evidence:**
  - The public auth settings of staging show `mailer_autoconfirm: false`, so every new account must confirm by email.
  - No custom SMTP configuration exists in the repository, and the dashboard SMTP settings couldn't be inspected without dashboard access.
  - No real inbox was used. I deliberately triggered no emails, because sends to fake addresses can get a project's mail sending restricted.
  - Supabase's built-in mailer is meant for development: it is heavily rate-limited and (per Supabase's documentation at the time of writing) only delivers to members of the project's organization. Verify the current terms in the dashboard.
- **Impact:** testers can't finish sign-up or reset a forgotten password. Sign-in itself works.
- **Fix:** choose one.
  - **A (simplest for 5–10 testers):** create tester accounts as confirmed users in the dashboard, share passwords out of band, then disable public sign-ups. Password reset still needs email, so document a manual reset path.
  - **B:** configure custom SMTP (a transactional email provider; free tiers usually suffice for this volume), test confirmation and reset with a real inbox, and set the email rate limits in the dashboard.

**H2 · No production environment; staging is shared with the test suites** · Launch blocker: **Yes**
- **Evidence:**
  - There's a single Supabase project (staging), which the live test suite writes to: it creates and deletes users, and creates daily challenge rows.
  - No hosting provider is selected and nothing is deployed.
- **Impact:** testers' data would mix with automated test runs. A test cleanup bug could delete real tester data, and integrity checks would lose meaning.
- **Fix:** create a separate Supabase project for the alpha, push all 9 migrations to it, and host the app (see "Deployment recommendation").

**H3 · No privacy notice or data-controller identification** · Launch blocker: **Yes** (legal requirement)
- **Evidence:** no privacy page, and no controller name or contact anywhere in the app. The app processes e-mail addresses, display names, gameplay records, department membership, and survey answers including free text.
- **Impact:** GDPR Art. 13 requires informing data subjects when their data is collected (controller identity and contact, purposes, legal basis, recipients/processors, retention, rights). This applies to a small private alpha too.
- **Fix:** publish a short privacy notice with the real controller details. I didn't write one because the identity details must come from you. See "Privacy and legal".

**H4 · Auth redirect URLs aren't configured for a hosted domain** · Launch blocker: **Yes**
- **Evidence:**
  - The app builds email redirect links from the current origin (`window.location.origin` + `/auth/confirm`).
  - Supabase only redirects to URLs in its allowlist, and `docs/backend.md` already notes the staging Site URL and redirect URLs as still to be set.
- **Impact:** confirmation and reset links would land on localhost or be rejected.
- **Fix:** in the production project, set **Site URL** to the alpha domain and add `https://<alpha-domain>/auth/confirm` (plus any preview domain you'll actually use) to **Redirect URLs**.

**H5 · No error boundaries: one failing app blanked the whole desktop** · **Fixed in this audit**
- **Evidence (before):** a malformed `/api/daily` response (`today: "malformed"`) threw `k?.today.find is not a function`; the desktop icons, taskbar and every window disappeared.
- **Fix:** [app-error-boundary.tsx](../src/desktop/components/app-error-boundary.tsx) wraps every window. A crash shows "… stopped working" with **Try again** inside that window only.
- **Verified after:** the desktop and taskbar stay visible, the fallback appears, reopening recovers, other apps still work, and there are no page errors.

### Medium

**M1 · No HTTP security headers** · **Fixed in this audit**
- **Evidence (before):** responses had no `X-Frame-Options`, CSP, `nosniff`, Referrer-Policy or HSTS, and did send `X-Powered-By: Next.js`. The game could be framed by any site (clickjacking).
- **Fix:** `next.config.ts` now sends the following on every response, with `poweredByHeader: false`:
  - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
  - `Strict-Transport-Security` (effective over HTTPS only)
- **Verified** with response headers.
- **Remaining:** no `script-src` CSP yet, because Next's inline scripts would need nonces. "Can wait."

**M2 · Cross-site writes accepted by the API** · **Fixed in this audit**
- **Evidence (before):** `POST /api/feedback` with `Origin: https://evil.example` and `Content-Type: text/plain` returned **200**. Account endpoints were protected by `SameSite=Lax` session cookies, but guest feedback could be submitted from any website through visitors' browsers.
- **Fix:** [src/proxy.ts](../src/proxy.ts) rejects `POST`, `PUT`, `PATCH` and `DELETE` to `/api/*` when `Origin` doesn't match the host, or when `Sec-Fetch-Site` is `cross-site` or `same-site` (**403** `cross_site_request`). Requests without browser origin headers (non-browser clients, which can't use a visitor's cookies) pass.
- **Verified:** foreign-origin and `Sec-Fetch-Site` probes return 403, same-origin requests reach their routes, and all 214 browser checks and 59 live tests pass.
- **Note:** this relies on the `Host` header reaching the app unchanged. Managed hosts do this; check it if you self-host behind a proxy.

**M3 · Public sign-up is open while the alpha is invite-only** · Launch blocker: No (fix before launch)
- **Evidence:** staging auth settings show `disable_signup: false`.
- **Impact:** anyone who learns the URL can register and play. Their data enters the alpha dataset, and their feedback isn't distinguishable from testers'.
- **Fix:** after creating or inviting tester accounts, disable sign-ups in the production project (Authentication → Sign In / Providers).

**M4 · No self-service account or data deletion** · Launch blocker: No (but needs a documented process)
- **Evidence:** no deletion flow in the app. Deleting the auth user in the dashboard removes everything through cascades (tested: results, XP, contributions, memberships, achievements, daily attempts, feedback). Guest feedback can be erased with `delete_feedback_responses`, but only if the guest's browser token is known.
- **Impact:** GDPR erasure requests must be handled manually.
- **Fix:** name a contact for deletion requests in the privacy notice. Handle requests by deleting the user in the dashboard; guest feedback is pseudonymous and can't be linked to a person without the browser token, so state that.

**M5 · Rate limits are in memory and per instance; guest limit keys trust `X-Forwarded-For`**
- **Affected:** all API routes (in-memory limiter) and `/api/feedback` for guests (per-address limit).
- **Evidence:**
  - [rate-limit.ts](../src/server/rate-limit.ts) keeps counters in one process's memory.
  - The guest feedback limit is keyed on a hash of `x-forwarded-for` / `x-real-ip`.
  - The authoritative limits are in the database: round creation per player; feedback 5 revisions per guest token and 60 guest submissions per hour globally.
- **Impact:** on serverless hosting, every instance has its own counters. On hosts that pass client-supplied `X-Forwarded-For` through, a spammer can rotate the header. The global cap still bounds guest spam at 60 per hour, but a spammer could use it up and block genuine guest feedback for an hour.
- **Fix:** acceptable for an invite-only alpha. Later, move the limits to a shared store, or disable guest feedback if abuse appears. Check how the chosen host handles `X-Forwarded-For`.

**M6 · No error monitoring or alerting**
- **Evidence:** errors go to server logs (`console.error`) only; there's no error reporting service and no uptime check.
- **Impact:** failures during the alpha would go unnoticed unless a tester reports them.
- **Fix (before launch, free options suffice):**
  - read the host's runtime logs daily
  - run `check_progression_integrity` daily (all counters must be 0)
  - run `npm run feedback:report` daily
  - optionally add an error-reporting service later

**M7 · Session cookie is readable by JavaScript and long-lived** · Launch blocker: No
- **Evidence:** after sign-in, the `sb-<ref>-auth-token` cookie has `httpOnly: false`, `sameSite: Lax` and a 400-day expiry. It showed `secure: false` on `http://localhost`; whether it's set over HTTPS wasn't verified. This is how Supabase's browser client works: it reads the session from JavaScript.
- **Impact:** any future XSS bug could read the session. No XSS sinks exist today: no `dangerouslySetInnerHTML`, `innerHTML` or `eval`, and React escapes all user text.
- **Fix:**
  - Verify the cookie carries `Secure` on the HTTPS deployment.
  - Consider a nonce-based `script-src` CSP later.
  - Session lifetime is governed by Supabase's JWT expiry and refresh-token settings; review them in the dashboard. Time-boxed sessions are a paid feature.

**M8 · Only Chromium was tested** · Launch blocker: No (fix before launch)
- **Evidence:** only Chromium is installed for automated tests. Safari (iOS/macOS) and Firefox weren't tested.
- **Impact:** testers on iPhones use WebKit. Range sliders, `position: fixed` layouts, `localStorage` in private mode and cookie behaviour can differ there.
- **Fix:** before inviting testers, do one manual pass on iOS Safari and Firefox: orientation, one round of each game, the survey.

### Low

| ID | Finding | Evidence | Recommendation | Blocker |
|---|---|---|---|---|
| L1 | Password minimum (8 characters) enforced only in the browser form | `auth-store.ts` checks length; the server minimum is a Supabase setting that wasn't verified | Set minimum length 8 in the production project's auth settings | No |
| L2 | Dev-only dependency advisories | `npm audit --omit=dev`: **0** vulnerabilities. Full audit: 16 moderate, all in the ESLint toolchain (`minimatch` ReDoS) | Update ESLint dependencies later; no runtime exposure | No |
| L3 | Every app is loaded up front | Client JS 1,177 KB raw / 339 KB gzip across 7 chunks; all apps imported by the registry | Lazy-load game apps later | No |
| L4 | Company snapshot reads all of the quarter's events per request (cached per instance) | Benchmark: 5,000 events build in 10.4 ms (≈2.6 MB payload); 50,000 events take 129 ms (≈26 MB) | Fine for an alpha (≈2,000 events expected); aggregate in SQL before a larger launch | No |
| L5 | Achievements re-evaluate the whole history on every career load | Benchmark: 5,000 results in 6.6 ms; career API median 165 ms | Fine for an alpha; incremental evaluation later | No |
| L6 | Guest-history import has no per-account total cap | 200 records per call, 10 calls/min per instance, no database cap | Add a per-user cap if abuse appears | No |
| L7 | Testers flagged `test_account` are excluded from the Live Company | By design for QA accounts | **Don't** set `test_account` on real tester accounts | No (checklist) |
| L8 | The orientation shows once on a new device before sign-in | Observed in journey C (by design: remembered per device) | Accept; maybe skip it when a session already exists | No |
| L9 | Schema drift beyond migrations not diffed | `supabase migration list`: 9/9 local = remote. `supabase db diff` needs Docker (not run). Live privilege tests pass | Run `supabase db diff` once Docker is available | No |
| L10 | Real cross-midnight behaviour not observed live | Covered by a PGlite test that simulates a round started before midnight | Observe one midnight during the alpha | No |
| L11 | Free-tier Supabase projects pause after a period of inactivity, and backup coverage depends on the plan | Not verified for any project | Check the plan's pausing and backup rules for the alpha project; take a manual dump before launch | No |
| L12 | Two heavy simulation tests flaked at the 5 s default timeout | Pipeline Panic generator test failed at 5.7–6.0 s under full-suite load | **Fixed:** explicit 20 s timeouts; 3 consecutive full runs passed | No |

---

## Launch blockers

1. **H2 Production environment:** a separate Supabase project with the migrations applied, and a hosted deployment.
2. **H1 Email:** confirmation and reset email verified with a real inbox, *or* pre-created confirmed tester accounts with public sign-up disabled.
3. **H4 Redirect URLs:** Site URL and Redirect URLs set for the alpha domain.
4. **H3 Privacy notice:** controller identity and contact, purposes, legal basis, processors, retention and rights, reachable from the app or the invitation.

## Fix before launch

- **M3:** disable public sign-ups once testers have accounts.
- **M4:** document the deletion process (contact and dashboard deletion) in the privacy notice.
- **M6:** daily operations routine: host logs, integrity check, feedback report.
- **M7:** confirm the auth cookie is `Secure` over HTTPS.
- **M8:** manual pass on iOS Safari and Firefox.
- **L1:** set the server-side password minimum to 8.
- **L7:** make sure real tester accounts are **not** flagged `test_account`.
- **L11:** confirm the plan's pausing and backup rules; take a manual database dump before launch.

## Can wait

- Nonce-based `script-src` CSP (M1 follow-up).
- Shared-store rate limiting and trusted client IPs (M5).
- Error-reporting service (M6 follow-up).
- Lazy-loaded apps (L3); SQL-side company aggregation (L4); incremental achievements (L5); import cap (L6).
- Updating the ESLint toolchain (L2); `supabase db diff` check (L9).
- UX polish:
  - skip the orientation for a restored session on a new device (L8)
  - tell testers that the Live Company excludes QA accounts
  - the round clock's first-frame "1:30" before the first tick

---

## Privacy and legal

This is an engineering assessment, **not legal advice**. Items marked "legal review" need someone qualified to decide.

**Legal requirements (GDPR, testers in the EU):**
- **Information duty (Art. 13), before data is collected.** The notice must cover:
  - controller name and contact address
  - purposes: running the game and accounts, verified progress, product research through the survey
  - legal basis: likely Art. 6(1)(b) for the account and game; for the survey, consent or legitimate interest (**legal review**)
  - recipients and processors: Supabase (database and auth, EU region eu-central-1 for staging); the hosting provider; an email provider if SMTP is added
  - any transfers outside the EU (check each provider's data processing agreement and subprocessors)
  - retention periods
  - data-subject rights, and the right to complain to a supervisory authority
- **Processing agreements (Art. 28):** accept Supabase's and the host's data processing agreements for the production accounts.
- **Erasure and access rights:** must be possible on request. Technically supported through dashboard deletion (M4).

**Data actually processed** (from code and schema):

| Category | Fields |
|---|---|
| Account | email, password hash (Supabase Auth), display name, employee number |
| Gameplay | rounds, scores, times, hints used, XP, department memberships, achievements, daily attempts, contribution events |
| Feedback | four ratings, optional free text, games played, round count, guest or account, broad device category. Guests are grouped by a hash of a random browser token; IP addresses are hashed in memory only and never stored |
| Browser storage | session cookie, plus `localStorage` for guest progress, orientation/checklist/survey state and Daily Challenge drafts. No analytics, no tracking, no third-party scripts |

**Recommendations (not strict requirements):**
- **Retention:** define one, e.g. "alpha data deleted within N weeks after the alpha ends unless you keep your account". Survey answers are research data; consider deleting them after analysis.
- **Storage consent (legal review):** cookies and `localStorage` are used only for functions the tester requested (sign-in, saving progress, remembering dismissed prompts). Under § 25 TDDDG, strictly necessary storage doesn't need consent; there is no tracking, so no consent banner is planned.
- **Public identities:** no real leaderboard exists; the Leaderboard app shows labelled fictional data, and Daily standings show only rank and count. If a leaderboard with display names is added, ask for opt-in.

**Needs legal review:**
- **Impressum (§ 5 DDG):** required for "geschäftsmäßige" digital services. Whether a private, invite-only, non-commercial alpha qualifies depends on the circumstances (e.g. commercial intent).
- **Legal basis for the survey,** and whether to ask testers to agree to alpha terms.

---

## Deployment recommendation

For 5–10 testers: **one managed Next.js host + one dedicated Supabase project, both in Frankfurt or the EU.**

```text
Testers (browser) ── HTTPS ──▶ Next.js app on a managed host (EU region, e.g. Frankfurt)
                                   │  server-only: SUPABASE_SECRET_KEY
                                   ▼
                     Supabase project "corporate-ladder-alpha" (eu-central-1)
                     Auth + Postgres (9 migrations) · sign-ups disabled after invites

Staging project (existing) stays for development and the live test suite only.
```

- **Host:** any managed host with first-class Next.js 16 support:
  - proxy (middleware)
  - Node runtime for route handlers (`node:crypto` is used)
  - environment variables
  - instant rollback
  - preview deployments

  Vercel is the most direct fit for Next.js. Check whether the free tier's terms allow your use (non-commercial vs commercial), or budget for a paid plan; Netlify, Render or a small container host also work. Choose the region next to eu-central-1. No provider has been chosen or contacted.
- **Environment variables (production only):**
  - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public)
  - `SUPABASE_SECRET_KEY` (secret, server only: never prefixed `NEXT_PUBLIC_`, never in previews connected to production)
  - Point preview deployments at **staging**, not production.
- **Domain:** the host's default HTTPS subdomain is enough for a closed alpha. A custom domain is optional.
- **Access:** invite-only through pre-created accounts or invitations, then sign-ups disabled. Guest mode remains open to anyone with the URL; keep the URL unlisted, or accept guest traffic.
- **Migrations:** `supabase link` to the alpha project → `supabase db push --dry-run` → review → `supabase db push`. The migrations seed all reference data (departments, rules, formulas, achievement definitions, daily assignments).
- **Rollback:**
  - **App:** use the host's instant rollback to the previous deployment.
  - **Database:** migrations are forward-only and additive. Take a manual `supabase db dump` before every push; to undo a change, write a new reviewed migration.
- **Spending:** use plans with hard caps (Supabase free plan, or a spend cap on paid plans; the host's spend controls).
- **Logs and monitoring:** host runtime logs, Supabase logs, a daily integrity check, a daily feedback report (M6).

---

## Closed alpha launch checklist (in order)

1. Decide the email approach (H1 option A or B). If B, set up SMTP and test sign-up and reset with a real inbox.
2. Write the privacy notice with real controller details (H3) and get the legal-review items answered (Impressum, survey legal basis).
3. Create the Supabase project "corporate-ladder-alpha" in eu-central-1. Accept the data processing agreement, set password minimum 8 (L1), and check pausing and backup rules (L11).
4. Link and push the 9 migrations (dry run first). Run `check_progression_integrity`: all counters 0.
5. Choose the host, connect the repository (branch `corporate-progression` or a release branch) and set the environment variables (production → alpha project; previews → staging).
6. Deploy. Set Site URL and Redirect URLs (H4).
7. Verify on the deployed URL:
   - HTTPS and HSTS headers
   - the `Secure` flag on the auth cookie (M7)
   - `X-Powered-By` absent
   - a cross-site POST returns 403
8. Smoke test on the deployed URL with one account (not flagged `test_account`): sign-in, one verified round in each game, a Daily Challenge, the survey.
9. Manual pass on iOS Safari and Firefox (M8).
10. Create the tester accounts or invitations; then disable public sign-ups (M3).
11. Link the privacy notice in the invitation email and in the app.
12. Take a manual database dump, then send the invitations.
13. Daily during the alpha: host logs, integrity check, `npm run feedback:report`. Observe one UTC midnight Daily Challenge rollover (L10).
14. After the alpha: export feedback, apply the retention policy, and delete or keep accounts as announced.

---

## Test results (this audit run)

| Check | Result |
|---|---|
| ESLint | **Pass** (0 errors, 0 warnings) |
| TypeScript (`tsc --noEmit`) | **Pass** |
| Vitest, before fixes | 628/629: **1 flaky failure** (Pipeline Panic generator test, 5.7 s > 5 s timeout) |
| Vitest, after fixes | **632/632**, 3 consecutive passes (3 new tests for the cross-site check) |
| Production build (`next build`, repo and scratchpad copy) | **Pass**: compiled in ≈5 s, 15 routes, 0 warnings |
| Secrets in client assets | **None:** the secret key and database password don't appear in any `.next/static` file or prerendered HTML |
| `npm audit --omit=dev` | **0** vulnerabilities (full audit: 16 moderate, ESLint toolchain only) |
| Live staging tests (target confirmed: staging project ref `lalcer…`) | **59/59**, before and after fixes |
| Browser suites (Chromium, production build) | **214/214** checks in 9 suites, before and after fixes: journey 27, feedback 32, onboarding 36, daily 21, achievements 19, Pipeline Panic 29, departments 24, verified play 16, company 10 |
| Supabase outage simulation (unreachable Supabase URL) | Pages load; guest play works; company shows an "unavailable" state (503 in 34 ms); feedback returns a generic 500 shown as "Not saved" with a retry; sign-in says "Couldn't reach the account service"; no secrets in logs |
| Security probes (fixes M1, M2, H5) | Headers present; cross-site POST returns 403; crash contained to one window |
| Migrations | 9/9 local = staging |
| Cleanup | Staging after the run: 0 users, 0 rows in every player table, 0 feedback rows, all integrity counters 0. Daily challenge definition rows were preserved; test accounts were deleted, and guest feedback was erased per test token |

**Measured performance** (localhost production build → staging eu-central-1):

| Measurement | Result |
|---|---|
| First load | TTFB 4–21 ms; DOMContentLoaded 13–135 ms; load 47–143 ms (cold vs. warm) |
| Orientation visible after navigation | 91–250 ms |
| API median of 5 sequential calls | `/api/career` 165 ms · `/api/daily` 136 ms · `/api/feedback/status` 85 ms · `/api/company` 6 ms (cached) |
| JS heap after a 3-round guest session and after the full registered journey | 16.3 MB |

Real users far from Frankfurt, or on mobile networks, will see higher latencies; there was no load test with concurrent users.

**Not run, and why:**
- **Real email delivery:** no test inbox, and sending to fake addresses risks the project's email reputation.
- **`supabase db diff`:** needs Docker.
- **Safari and Firefox:** engines not installed; I didn't download any.
- **A real UTC midnight:** a PGlite simulation was used instead.
- **Concurrency beyond the existing tests:** no load test.

---

## Changes made during this audit (uncommitted)

| File | Change |
|---|---|
| `src/desktop/components/app-error-boundary.tsx` (new) | Per-window error boundary (H5) |
| `src/desktop/components/desktop.tsx` | Wraps each app window in the boundary |
| `next.config.ts` | Security headers; `poweredByHeader: false` (M1) |
| `src/lib/same-origin.ts` (new) + test | Cross-site write check (M2) |
| `src/proxy.ts` | Rejects cross-site writes to `/api/*` (M2) |
| `src/games/pipeline-panic/pipeline.test.ts` | Explicit 20 s timeouts on two heavy simulation tests (L12) |
| `docs/closed-alpha-readiness.md` (new) | This report |

No scoring, XP, economics, migrations, Supabase settings or infrastructure were changed.

---

## Final recommendation: **CONDITIONAL GO**

**What's ready:**
- **Server authority:** gameplay is server-authoritative, scoring and timing can't be forged, and the database rejects every direct write path tested.
- **Data integrity:** holds under concurrency and retries.
- **Onboarding and feedback:** behave as designed.
- **Outages:** the app degrades gracefully.

The remaining gaps aren't defects in the product. They're the parts of running a service for real people that don't exist yet: a production environment, working account email, configured redirects, and a privacy notice naming who is responsible for testers' data.

Each is a small, well-defined task, and the checklist puts them in order. Invite testers after steps 1–12 are done; don't invite anyone against the staging project.
