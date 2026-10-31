# Backend Foundation v0.1

Supabase Auth and PostgreSQL behind LadderOS, with server-verified Reconciliation Rush rounds.

The app works with or without a backend:

| Mode | When | Progress |
|---|---|---|
| **Guest** | Supabase isn't configured, or the player isn't signed in | Saved in this browser only (`localStorage`), scored in the browser, never verified or ranked |
| **Cloud** | Signed in | Rounds are scored by the server and saved to the account, along with XP from the server's ledger |

## Setup

**Staging status:** a staging project `corporate-ladder-staging` (ref `lalcervasxqjmrywgdzf`, eu-central-1) exists. The migration is applied and its keys are in the git-ignored `.env.local`. The Auth redirect URLs (step 4) still need to be set in the dashboard before email links work. The steps below also apply to future environments.

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
| `profiles` | One per auth user (created by trigger): employee number, display name, optional department | Read own; update `display_name`, `department_id` only |
| `departments` | Reference list | Read |
| `game_rules` | Pinned rules per game version: duration, tolerance, XP divisor, rate limit | Read |
| `game_sessions` | Server-created rounds: secret seed, start, deadline, hint, status | **None** (the seed regenerates the answer key) |
| `game_results` | One verified result per session, plus the scored cells | Read own |
| `xp_ledger` | Authoritative XP: one row per result, `unique(source_type, source_id)` | Read own |
| `legacy_practice_results` | Imported guest history (unverified, no XP) | Read own |

- **Writes:** all writes go through `SECURITY DEFINER` functions that only `service_role` can execute.
- **Grants:** the migration revokes Supabase's default grants and grants only the privileges above.
- **Row level security:** enabled on every table.

## Authentication

- **Sign up** (email, password of at least 8 characters, display name): Supabase sends a confirmation link → `/auth/confirm` → the session is set → the desktop shows "Email confirmed".
- **Sign in / sign out:** sessions persist in cookies, and are restored on refresh and kept fresh by `proxy.ts`. Sign-out clears the local session even if the network call fails.
- **Password reset:** "Forgot password" → email link → `/auth/confirm?flow=recovery` → Employee Profile asks for a new password. The response is identical whether or not the email has an account.
- **Guests:** play without an account. With no Supabase configured, account UI shows that accounts are unavailable.

## Verified round lifecycle

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

## Guest-to-account migration

Signed-in players with guest rounds in this browser see an **Import as legacy practice** offer in Corporate Career.

- **Unverified:** guest rounds were scored in the browser, so they are stored as **legacy practice**. They stay visible to the player but never count toward XP, rank or rankings.
- **Safe to repeat:** the import is idempotent per local round id and limited to 200 records per request.
- **Nothing is deleted:** the browser copy is never deleted, so the player can retry or import into another account.

## Testing

| What | How | Proves |
|---|---|---|
| Migration, RLS, grants, constraints, SQL functions | Vitest + **PGlite** (real Postgres in WASM) running the actual migration with Supabase-like roles and default grants | Postgres-level security and exactly-once logic |
| Round lifecycle (start, hint, submit, deadlines, tampering, cross-user, duplicates, replay, rules versions) | Service + RPC adapter + real SQL functions in PGlite | Server authority over scores, time and XP |
| Auth state, career scopes, cloud repository, guest import | Unit tests with fakes | Client state handling |

| Live staging: Supabase Auth, PostgREST, RLS, the full HTTP lifecycle, truly concurrent submissions, deadlines, rate limits, import, profile | `npm run test:live` (opt-in; needs `.env.local`, plus `LIVE_BASE_URL` pointing at a running build). Creates and deletes test users | The deployed security model on a real Supabase project |

**Still not automated:** the real sign-up confirmation and password-reset emails, because a test inbox is needed.

**Never** point `test:live` at production.

## Known limitations

- **Hint timing:** the countdown is local and display only. A player whose clock or connection stutters may see a slightly different end time than the server. The server's verdict is final.
- **Rate limits:** the in-memory limits are per server instance. The database limit on round creation is the authoritative one.
- **Account switching mid-round:** switching accounts during a verified round leaves that round to be abandoned when the next one starts.
- **History size:** history views read up to 500 recent results. Totals (XP) come from the full ledger.
