# Backend Foundation v0.1

Supabase Auth and PostgreSQL behind LadderOS, with server-verified Reconciliation Rush rounds.

The app works with or without a backend:

| Mode | When | Progress |
|---|---|---|
| **Guest** | Supabase isn't configured, or the player isn't signed in | Saved in this browser only (`localStorage`), scored in the browser, never verified or ranked |
| **Cloud** | Signed in | Rounds are scored by the server and saved to the account, along with XP from the server's ledger |

## Setup

**Staging status:** a staging project `corporate-ladder-staging` (ref `lalcervasxqjmrywgdzf`, eu-central-1) exists. Both migrations are applied and its keys are in the git-ignored `.env.local`. The Auth redirect URLs (step 4) still need to be set in the dashboard before email links work. The steps below also apply to future environments.

1. **Create a Supabase project** at supabase.com.
2. **Apply the migration.** Use either option:
   - `supabase link --project-ref <ref>`, then `supabase db push`
   - Paste `supabase/migrations/20261030120000_backend_foundation.sql` into the SQL editor and run it once.
3. **Configure the environment:** copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Project Settings → API Keys)
   - `SUPABASE_SECRET_KEY`: secret key (or `SUPABASE_SERVICE_ROLE_KEY` with the legacy `service_role` key). **Server only.** On Vercel, add it as an environment variable that isn't exposed to the browser. Note: `supabase projects api-keys` shows new-style secret keys masked, so copy them from the dashboard.
4. **Configure Auth** (Authentication → Providers / URL Configuration):
   - **Email provider:** enabled, with **Confirm email** turned on.
   - **Site URL:** your deployment URL (e.g. `http://localhost:3000` for local development).
   - **Redirect URLs:** add `<site>/auth/confirm` (and the same for every deployment URL).
   - **Email templates:** optional but recommended, for the token-hash flow.
     - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
     - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

     The default templates also work: `/auth/confirm` handles the PKCE `?code=` flow as well.
   - **SMTP:** configure custom SMTP before real users sign up (Supabase's built-in sender is rate-limited and meant for testing).
5. **Restart** `npm run dev` after changing environment variables.

**Verify the setup:**
1. Create an account in Employee Profile.
2. Confirm the email.
3. Play Reconciliation Rush. The lobby should say "Verified play".
4. Check Corporate Career for the result and XP.

## Architecture

```
Browser                                Next.js server (trusted)                 Supabase
───────                                ────────────────────────                 ────────
auth/auth-store ── supabase.auth ──────────────────────────────────────────────▶ Auth (email + password)
services/api-client ─ POST /api/rounds ─▶ server/rounds/service ── rpc ────────▶ create_game_session()
  (cells only)        POST …/hint      ─▶   rebuilds challenge from seed ─ rpc ─▶ record_game_hint()
                      POST …/submit    ─▶   scores with the game engine ── rpc ─▶ finalize_game_session()
performance/use-career ─ GET /api/career ─▶ server/career/service ── RLS reads ─▶ profiles, results, xp_ledger
proxy.ts ── refreshes session cookies on each request
```

- **Separate clients:**
  - `lib/supabase/browser.ts`: publishable key, RLS applies.
  - `lib/supabase/server.ts`: per request, acts as the signed-in player, RLS applies.
  - `lib/supabase/admin.ts`: secret key, `server-only`, used only to call the trusted SQL functions.
- **Game rules stay in TypeScript:** the server runs the same pure modules as the browser (`games/spreadsheet-wars/reconciliation-rush/*`): generator, formula engine, validation, scoring.
- **One progression state:** `performance/career-scope.ts` picks the guest store or the signed-in account's store. The desktop builds the displayed employee from it (`performance/player.ts`), so the taskbar, Career, Profile and Leaderboard always agree. Account stores are discarded on sign-out or account switch, and guest data is never shown as account data.

## Database schema

| Table | Purpose | Browser access |
|---|---|---|
| `profiles` | One per auth user (created by trigger): employee number, display name, current department (only via `select_department`) | Read own; update `display_name` only |
| `department_memberships` | Append-only membership history (see [careers.md](careers.md)) | Read own |
| `departments` | Canonical departments (`kind`: operating / support) | Read |
| `game_rules` | Pinned rules per game version (Reconciliation Rush, Pipeline Panic): duration, tolerance, XP divisor, rate limit | Read |
| `game_sessions` | Server-created rounds: secret seed, start, deadline, hint, status | **None** (the seed regenerates the answer key) |
| `game_results` | One verified result per session, plus the scored cells | Read own |
| `xp_ledger` | Authoritative XP: one row per result, `unique(source_type, source_id)` | Read own |
| `legacy_practice_results` | Imported guest history (unverified, no XP) | Read own |
| `contribution_formulas` | Versioned contribution formulas per game | Read |
| `contribution_allocations` | Metric/department split per formula, in basis points | Read |
| `contribution_events` | Append-only company contribution events, one per verified round | **None** (server reads only) |
| `achievement_definitions` | Achievement ids, categories, rarities, status (see [achievements.md](achievements.md)) | Read |
| `player_achievements` | Append-only unlocks, one per player and achievement, with the source record | Read own |
| `daily_assignments` | The recurring Daily Challenges (see [daily-challenges.md](daily-challenges.md)) | Read |
| `daily_challenges` | One per assignment and UTC day: pinned rules, secret shared seed | **None** (not even the service role) |
| `daily_challenge_attempts` | One ranked attempt per player and challenge, linked to its session | Read own |
| `feedback_responses` | Employee Experience Survey answers, append-only revisions (see [alpha-feedback.md](alpha-feedback.md)) | **None** (not even the service role) |

- **Writes:** all writes go through `SECURITY DEFINER` functions that only `service_role` can execute.
- **Grants:** the migration revokes Supabase's default grants and grants only the privileges above.
- **Row level security:** enabled on every table.

## Authentication

- **Sign up** (email, password of at least 8 characters, display name): Supabase sends a confirmation link → `/auth/confirm` → the session is set → the desktop shows "Email confirmed".
- **Sign in / sign out:** sessions persist in cookies, and are restored on refresh and kept fresh by `proxy.ts`. Sign-out clears the local session even if the network call fails.
- **Password reset:** "Forgot password" → email link → `/auth/confirm?flow=recovery` → Employee Profile asks for a new password. The response is identical whether or not the email has an account.
- **Guests:** play without an account. With no Supabase configured, account UI shows that accounts are unavailable.

## Verified round lifecycle

Both games (Reconciliation Rush and [Pipeline Panic](pipeline-panic.md)) use this lifecycle and the same database functions. Each game's service accepts only its own sessions, and a player has one active round across games.

1. **Start:** `POST /api/rounds`. The server creates a 128-bit secret seed. The database records `started_at = now()` and the deadline, and abandons any unfinished round. The response contains the **public puzzle only** (no solutions, planted errors or seed).
2. **Play:** the client keeps edits locally and shows a countdown derived from server time (display only).
3. **Hint:** `POST /api/rounds/:id/hint` with the current cells. The server picks an unresolved discrepancy and stores it once, so repeats return the same hint. No score penalty.
4. **Submit:** `POST /api/rounds/:id/submit` with `{ entries }` (cell contents only). Any score, time or XP fields in the body are ignored. The server:
   - rebuilds the challenge from the seed and the pinned rules version
   - validates the cells (editable cells only, string ≤ 256 characters, at most one entry per editable cell, body ≤ 16 KB)
   - judges timing with **database time**
   - scores the sheet and finalizes the session in one transaction
5. **Timing rules:**

   | Database time at submission | Completion | Cells scored? | Time bonus |
   |---|---|---|---|
   | Before the deadline | submitted | yes | possible |
   | Within 3 s after the deadline | timed out | yes | no |
   | Later | timed out | no (they could have been edited after time ran out) | no |

6. **Never submitted:** a round that is never submitted (closed window, lost connection) has no result and no XP. It is abandoned when the player starts another round.
7. **Retries:** after a network failure the client retries the same session. Finalization is idempotent: a repeat returns the stored result unchanged.

## How XP is protected

- **XP comes from the score, inside the database:** `floor(score / game_rules.xp_score_divisor)` (= 1 XP per 20 points). Clients never send XP.
- **Exactly once:** the session row is locked with `FOR UPDATE`. One result per session (primary key) and one ledger row per result (unique constraint), in one transaction.
- **No replay XP:** a seed the player already completed earns 0 XP, and seeds are unique per session.
- **Rate limits:** 12 rounds per minute per player, enforced in the database. Every API route also has per-user limits (in memory, per server instance).
- **Ownership:** another player's session id behaves exactly like a nonexistent one (404).

**What this does not stop:** server verification prevents forged scores, times and XP. It does not prevent outside help, automated solving, or multiple accounts. The game's code is public, so a bot could solve the public puzzle. Address those with behavioral checks before any prizes or rankings matter.

## Company contribution events

Every verified round also creates one **contribution event** for the shared company (migration `20261031120000_company_contributions.sql`). The live company snapshot is computed from these events (see [Live company](#live-company)).

- **Created in the same transaction:** `finalize_game_session` inserts the result, the XP ledger row and the event together. If any part fails, none of it is written, and the session stays active so the client's retry can succeed.
- **Contents:** the verified scoring inputs (score, max score, errors fixed / total, incorrect corrections, completion, assistance), the pinned `rules_version` and `formula_version`, and `completed_at` (database time at finalization). Everything is copied from the stored result, not from the request.
- **Quarter:** `period_id` is a generated column, `utc_quarter(completed_at)`. Quarters are UTC calendar quarters (fiscal year = calendar year): Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec. Neither the client nor the server code can choose it.
- **No points stored:** contribution points are recomputed from the inputs by the TypeScript formula for the event's `formula_version` (`src/simulation/contribution.ts`). A new formula never rewrites history, and the engine rejects events whose formula version it doesn't implement.
- **Department allocation:** `contribution_allocations` pins each formula's split in integer basis points that sum to 10,000. Reconciliation Rush v1 is Ledger integrity → Controlling 7000 and Close quality → Finance 3000. Allocation rows are immutable, and a formula that already has events can't gain new rows. A new split means a new formula version.
- **Exactly once:** `unique(session_id)` gives one event per round, and duplicate or concurrent submissions return `duplicate`. `unique(user_id, game_id, seed)` means a player contributes once per seed in any quarter (a replay earns no event, just as it earns no XP).
- **Append-only:** triggers reject UPDATE, DELETE and TRUNCATE for every role, including the database owner. The one exception: events disappear by cascade when the player's account is deleted.
- **Recovery:** a retried submission of an already-finalized round records a missing event (`source = 'recovery'`). Since Live Company v0.1 the round service routes HTTP retries through `finalize_game_session` too, so this works over the normal API path (previously only direct calls reached it). `backfill_contribution_events(limit)` (service role) records missing events for older results, oldest first, so the earliest completion of a seed wins (`source = 'backfill'`). Both are idempotent. The migration ran the backfill once (staging had no results). Legacy guest imports are never read.
- **Access:**
  - Clients can't read or write events, and can't call the functions that create them.
  - The service role can read events and run the backfill. It can't insert, update or delete events directly, or call `record_contribution_event`.
  - Public statistics come only from `GET /api/company` (aggregates), never from per-player rows.
- **Cascade deletion (fixed in `20261031140000_harden_authoritative_data.sql`):** events still cascade from their result, but results, XP rows and sessions can no longer be deleted on their own (see [Authoritative data protection](#authoritative-data-protection)). A player's history is removed only all together, with the account.

## Authoritative data protection

Migration `20261031140000_harden_authoritative_data.sql`. What we found on staging, by inspecting `pg_roles`, table and column privileges, function owners and `pg_default_acl`:

- **Default privileges:** Supabase grants **all** privileges (`arwdDxtm`) on every new `public` table to `anon`, `authenticated` and `service_role`. Earlier migrations revoked them from `anon` and `authenticated` only. `service_role`, which also bypasses RLS, could insert, update, delete, truncate and add triggers or references on results, XP, sessions, profiles, imports and reference data. It could also execute the trigger functions `handle_new_user` and `touch_updated_at`.
- **Inconsistent deletes:** deleting a result cascaded to its contribution event but left its XP row, because `xp_ledger.source_id` has no foreign key.
- **What already held:**
  - `service_role` is not a member of `postgres` and can't create objects in `public`.
  - All SECURITY DEFINER functions are owned by `postgres` with `search_path = ''`.
  - `authenticator` can only switch to `anon`, `authenticated` and `service_role`.

Fix:

| Layer | Change |
|---|---|
| **Grants** | `service_role` is read-only on `game_results`, `xp_ledger`, `game_sessions`, `legacy_practice_results`, `profiles`, `game_rules`, `departments` and both sequences. Two narrow column grants remain: `game_sessions(started_at, deadline_at)` (live deadline tests; only for active rounds) and `profiles(display_name, department_id)` (the fields players can edit). Trigger functions can't be called directly. |
| **Owner-level triggers** (apply to every role, including `postgres`) | `game_results` and `xp_ledger` are append-only. `game_sessions` can't be deleted directly, are frozen once finalized or abandoned, and never change identity (user, game, rules, seed). Deletes that arrive as cascades from a profile or auth user are allowed, so **account deletion removes a player's sessions, results, XP, events and imports together**. |
| **Audit** | `check_progression_integrity()` (service role, read-only) counts finalized sessions without results, results without XP, XP without results, XP that disagrees with its result, results missing a contribution (seed replays excluded), and events that disagree with their result. All counts should be 0. |

Unchanged: finalization (SECURITY DEFINER functions run as the owner), recovery, backfill, imports, player RLS and table structure.

Remaining trust boundary: the `postgres` role (migrations, dashboard SQL editor) can still disable triggers. Protect database credentials and dashboard access accordingly.

Every new table gets Supabase's broad default grants. `server/security.test.ts` checks every table, column, sequence and function privilege against an allowlist, so a migration that forgets to revoke fails the tests.

## Live company

`GET /api/company` publishes the shared company for the current UTC quarter (migration `20261031130000_live_company.sql`, server `src/server/company/`, model `src/simulation/live.ts`).

- **Reading:** the server calls `get_company_quarter()`, a service-role-only, read-only SQL function. It returns registered employees, membership counts, the quarter's events (with player ids, which never leave the server) and the published allocations, in one consistent read. The database decides the current quarter.
- **Test accounts:** auth users with `app_metadata.test_account = true` aren't employees, and their events are ignored. `app_metadata` can only be set with the service role. The live tests flag every account they create, except one that verifies the real path and is deleted afterwards.
- **Computing:** events go through the existing engine: the pinned formula version per event, normalization, per-player quarterly caps, duplicate and seed-replay rejection, then `computeQuarter`. The server checks that the database allocations match the TypeScript formula and refuses to compute (503) if they differ.
- **Publishing:** aggregates only, with no player ids, rounds, seeds, events or points per player. Membership breakdowns withhold groups of 1–4 people, plus a second cell when only one would be withheld (`MIN_GROUP_SIZE = 5`). The response is validated by `parseCompanySnapshot` in the browser.
- **Caching:** `Cache-Control: no-store`. The server caches the snapshot for 15 s per instance and loads it single-flight. A verified submission on the same instance clears the cache, so the player sees their round right away. Other changes, such as new sign-ups and account deletions, appear within 15 s.
- **Errors:** `400` for any query parameter, `503 not_configured` without a backend, and `503 company_unavailable` (with `Retry-After`, no internal details) when the database fails or returns unexpected data. The app never falls back to demo data.

## Canonical departments

`src/config/departments.ts` is the single list and must match the table (a test checks this):

| id | Name | Kind |
|---|---|---|
| `finance` | Finance | operating |
| `controlling` | Controlling | operating (added) |
| `people` | Human Resources (was "People & Culture") | operating |
| `sales` | Sales | operating |
| `operations` | Operations & Supply Chain (was "Operations") | operating |
| `it` | IT & Engineering (was "IT") | operating |
| `marketing` | Marketing | operating |
| `legal` | Legal | support |
| `strategy` | Corporate Strategy (was "Strategy") | support |

Existing ids were kept, so no profile assignment changed. Only display names were updated, and one department was added. Since Department Careers v0.1, a player's department changes only through `select_department` (30-day transfer cooldown, append-only history); see [careers.md](careers.md). The company simulation uses the same ids. A player's department (membership) never decides which metrics a game feeds; the game's formula does.

## Guest-to-account migration

Signed-in players with guest rounds in this browser see an **Import as legacy practice** offer in Corporate Career.

- **Unverified:** guest rounds were scored in the browser, so they are stored as **legacy practice**. They stay visible to the player but never count toward XP, rank or rankings.
- **Safe to repeat:** the import is idempotent per local round id and limited to 200 records per request.
- **Nothing is deleted:** the browser copy is never deleted, so the player can retry or import into another account.

## Testing

| What | How | Proves |
|---|---|---|
| Contribution events: transactionality, duplicates, concurrency, seed replays, quarters, authorization, append-only guards, recovery, backfill, formula versions | Vitest + PGlite (`server/contributions.test.ts`) | The ledger's guarantees at the Postgres level |
| Privilege allowlist (every table, column, sequence, function and role), service-role write attempts, owner-level guards, account deletion, integrity audit | Vitest + PGlite (`server/security.test.ts`) | Authoritative data can only change through the trusted functions |
| Department membership: joining, idempotency, cooldown boundaries, transfers, returning, concurrency, client timestamps, RLS and direct writes, owner-level guards, account deletion, XP/contribution preservation, workforce counts | Vitest + PGlite (`server/departments/service.test.ts`), pure track/policy tests (`career/department-*.test.ts`) | Membership rules hold in the database |
| Achievements: registry/database consistency, each unlock condition, progress, promotions vs. the career policy, verified history only, exactly-once under retries and concurrency, backfill, source ownership, future ids, RLS and direct writes, append-only, account deletion, toast dedupe | Vitest + PGlite (`server/achievements/service.test.ts`), pure tests (`career/achievements.test.ts`, `achievements/toast-queue.test.ts`) | Unlocks come only from authoritative data, exactly once |
| Daily Challenges: shared puzzle per UTC day, different days, rules pinning, cross-midnight rounds, one attempt (concurrency, retries, resume, expiry and settlement), deadlines, seed and answer protection, sealed reviews, scoring consistency, XP and contribution once, careers, Daily Grind, standings and leaderboard, guests, authorization, append-only guards, account deletion, backend failures | Vitest + PGlite (`server/daily/service.test.ts`) | One fair ranked attempt per player and day, with nothing leaked |
| Alpha feedback: guest and account submissions, verified context for accounts, idempotency, revisions, validation, revision and global guest limits, privacy of reports, access control, append-only, erasure, account deletion; prompt rules, validation and report aggregation | Vitest + PGlite (`server/feedback/service.test.ts`), pure tests (`feedback/*.test.ts`) | Feedback is private, validated and never duplicated |
| Live company: aggregation from real verified rounds, test-account and guest-import exclusion, current quarter, caching and invalidation, failures, authorization, privacy | Vitest + PGlite (`server/company/service.test.ts`), handler tests (`http.test.ts`), pure model tests (`simulation/live.test.ts`) | The snapshot is correct, aggregate-only and fails safely |
| Migration, RLS, grants, constraints, SQL functions | Vitest + **PGlite** (real Postgres in WASM) running the actual migration with Supabase-like roles and default grants | Postgres-level security and exactly-once logic |
| Round lifecycle (start, hint, submit, deadlines, tampering, cross-user, duplicates, replay, rules versions) | Service + RPC adapter + real SQL functions in PGlite | Server authority over scores, time and XP |
| Auth state, career scopes, cloud repository, guest import | Unit tests with fakes | Client state handling |

| Live staging: Supabase Auth, PostgREST, RLS, the full HTTP lifecycle, truly concurrent submissions, deadlines, rate limits, import, profile, contribution events (creation, quarters, concurrency, access, cascade on account deletion), live company (`GET /api/company`, test-account exclusion, update right after a verified round, removal after account deletion), hardening (service-role writes denied, account deletion, integrity audit), departments (join, profile/career sync, idempotency, cooldown, concurrency, RLS, direct writes, account deletion), achievements (definitions, unlock and refresh, concurrent submits and loads, department and cross-game routes, forged sources and direct writes, account deletion), daily challenges (guest preview, same puzzle, one attempt, resume, sealed reviews, concurrent starts, practice protection and expiry, direct access, account deletion), alpha feedback (account and guest submissions, idempotency, status, validation and size limits, guest rate limit, privacy) | `npm run test:live` (opt-in; needs `.env.local`, plus `LIVE_BASE_URL` pointing at a running build). Creates and deletes test users | The deployed security model on a real Supabase project |

**Still not automated:** the real sign-up confirmation and password-reset emails, because a test inbox is needed.

**Never** point `test:live` at production.

## Known limitations

- **Hint timing:** the countdown is local and display only. A player whose clock or connection stutters may see a slightly different end time than the server. The server's verdict is final.
- **Rate limits:** the in-memory limits are per server instance. The database limit on round creation is the authoritative one.
- **Account switching mid-round:** switching accounts during a verified round leaves that round to be abandoned when the next one starts.
- **History size:** history views read up to 500 recent results. Totals (XP) come from the full ledger.
- **Live company scale:** each snapshot reads the whole quarter's events into the server (fine for thousands of rounds). Larger volumes need aggregation in SQL or a materialized per-player summary.
