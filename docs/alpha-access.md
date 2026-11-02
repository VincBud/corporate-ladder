# Closed Alpha Access: invitations and registration

Invite-only self-registration for the closed alpha (5–10 testers). Testers register with their own email and password plus a single-use invitation code, confirm their email, and play. Guest play stays open to everyone.

Code:
- `supabase/migrations/20261102120000_alpha_invitations.sql` and `20261102130000_alpha_invitation_no_exemptions.sql`
- `src/alpha/` (code format, generation, hashing)
- `src/server/alpha/service.ts`, `src/app/api/alpha/`
- the registration form in `src/apps/profile/account-panel.tsx`
- `scripts/alpha-invites.mts`

## Security design

**Where it's enforced: in the database, when the account is created.**
- A `BEFORE INSERT` trigger on `auth.users` (`enforce_alpha_invitation`) runs for every way Supabase Auth creates a user: the app's form, direct calls to `/auth/v1/signup`, the admin API and the dashboard.
- **When invitations are required** (`alpha_access_settings.invite_required`), the trigger rejects the insert if the sign-up metadata has no `alpha_invite`, or if the code is unknown, expired, revoked or already used. No account, profile or confirmation email is created.
- **Exemptions:** there are none. Real Supabase Auth applies custom `app_metadata` only after the insert, so an exemption flag could never be seen; the follow-up migration removed it.
- **Admin and dashboard accounts:** they need an invitation too while invitations are required. Pass `alpha_invite` in `user_metadata`, or switch the requirement off briefly.

**Why not the Before User Created hook:**
- It needs dashboard configuration.
- It runs outside the insert's transaction, so a redemption there could be lost, or a code burned when creating the user fails afterwards.

The trigger has neither problem: it is the same transaction as the account.

**Code properties:**

| Property | How |
|---|---|
| Random | `CL-XXXX-XXXX-XXXX`: 12 characters of Crockford base32 (no I, L, O, U), 60 bits from `crypto.randomInt` with no bias. Guessing is infeasible |
| Hashed | Only `sha256(normalized code)` is stored. Codes are shown once by the CLI and never logged. The trigger also removes the code from the account's stored metadata (verified against real Supabase Auth; only the API's immediate response echoes it back to the same client) |
| Single use | Redeemed inside the account-creation transaction under a row lock. Five truly concurrent sign-ups with one code create exactly one account (live-tested). If account creation fails for any other reason, the code stays unused |
| Typing-tolerant | Case, spaces and dashes don't matter; O/0 and I/L/1 are interchangeable |

**Abuse protection:**

| Risk | Protection |
|---|---|
| Guessing or enumerating codes | 60-bit codes. The pre-check (`POST /api/alpha/invitations/check`) gives only `{ valid }`, rejects malformed input without a database call, and is limited to 10 per 10 min per network address (hashed in memory, never stored). Supabase Auth's own sign-up rate limits apply to direct calls |
| Bypassing the app | Enforced by the database trigger, not the form (live-tested with direct `/signup` calls: no code, unknown code, forged exemption flags) |
| Duplicate registration | One account per code; an existing email address never consumes a code (Supabase doesn't insert a new user) |
| Email enumeration | Sign-up answers "check your inbox" whether or not the address exists ("already registered" errors get the same answer); password reset was already neutral |
| CSRF | Same-origin check on all API writes (`src/proxy.ts`). Sign-up itself goes from the browser to Supabase Auth |
| Error leakage | The pre-check says only valid or not. A refused sign-up says "This invitation code can't be used" |
| Direct table access | `alpha_invitations` and `alpha_access_settings` have no grants for any API role (not even the service role). Every function is service-role only. Owner-level guards keep hashes, expiry and redemptions immutable |

## Registration journey

1. The tester opens the alpha website: Employee Profile → **Create account**.
2. The form asks for the **invitation code** (shown when `GET /api/alpha` says invitations are required), display name, email, password and confirm password. The minimum is 8 characters; errors are clear and labelled, and the layout works on mobile.
3. The browser checks the code's shape and that the passwords match. The server pre-checks the code. Then the browser calls Supabase Auth `signUp` with `{ display_name, alpha_invite }`, and the database decides.
4. "Check your inbox and confirm your email address" appears, with **Resend confirmation**.
5. The email link opens `/auth/confirm`, which verifies the link, sets the session and returns to the desktop. The new tester then sees the Employee Orientation, and the "Email confirmed" notice appears after it.
6. The tester plays normally. The session persists across refreshes.

**Invalid or expired links** show "That link didn't work … request a new one".

**Password reset:**
1. Forgot password → the email arrives.
2. The link opens `/auth/confirm?…recovery` and shows "Choose a new password".
3. The tester saves the new password in Employee Profile.
4. A "Password updated" notice appears. The old password no longer works; the new one does.

## Invitation lifecycle

**open → redeemed** (an account was created; the listing shows "awaiting email confirmation" or "confirmed") **| expired | revoked**

| Situation | What to do |
|---|---|
| Tester never confirms | The code stays redeemed by the unconfirmed account. The tester can use **Resend confirmation**. After a week or so, delete that unconfirmed user in the dashboard and issue a new code |
| Wrong email address entered | Same: delete the unconfirmed user, issue a new code |
| Account deleted | The invitation stays redeemed, shown as "account deleted" (no reuse) |
| Code leaked before use | `revoke <id>` |

Invitations are append-only: they're never deleted, only revoked or redeemed.

## Management (developer only)

```sh
npm run alpha:invites -- create --count 8 --days 14 --note "wave 1"   # prints codes ONCE
npm run alpha:invites -- list                                          # statuses, no codes/hashes/emails
npm run alpha:invites -- revoke 1a2b3c4d                               # unused invitations only
npm run alpha:invites -- require on|off|status                         # the enforcement switch
npm run alpha:invites -- --env .env.alpha.local list                   # target another project
```

- The CLI uses the service role key from the chosen env file, and prints the target project before doing anything.
- Send each code to one tester privately. Never commit codes or paste them into shared places.

## Configuration for the alpha project (manual; nothing has been provisioned)

1. **Separate Supabase project** (e.g. `corporate-ladder-alpha`, eu-central-1).
   - `supabase link --project-ref <alpha ref>`, then `supabase db push --dry-run`, then `supabase db push` (all 11 migrations).
   - Put its keys in a git-ignored `.env.alpha.local`.
2. **Auth settings** (Authentication → Sign In / Providers):
   - Email provider on.
   - **Allow new users to sign up: ON.** The invitation trigger enforces the invite; turning sign-ups off would also block invited testers.
   - **Confirm email: ON.**
   - Minimum password length 8.
3. **Custom SMTP** (Authentication → SMTP). Resend is a good fit for this volume (its free tier covers a handful of testers; check current limits):
   - create an account, verify a sending domain (DNS records: SPF/DKIM, ideally DMARC), create an API key
   - enter Resend's SMTP host, port, username and password in Supabase
   - set sender name and address
   - raise the Auth email rate limit to suit
4. **URL configuration** (Authentication → URL Configuration):
   - Site URL = `https://<alpha domain>`
   - Redirect URLs: `https://<alpha domain>/auth/confirm`, plus any preview domain actually used
5. **Email templates (strongly recommended): token-hash links**, so a link works even when opened on another device or browser than the one used to sign up. The default PKCE links only work in the original browser.

   | Template | Link |
   |---|---|
   | Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` |
   | Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` |

   `/auth/confirm` already supports both (live-tested with `token_hash`).
6. **Hosting environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server only).
7. **Turn invitations on and create codes:**
   - `npm run alpha:invites -- --env .env.alpha.local require on`
   - `… create --count 8 --days 14`
8. **Verify email delivery** with a real mailbox you control, before inviting anyone:
   - sign up with a test code → confirmation arrives (inbox, not spam) → the link signs you in
   - Forgot password → the reset email arrives → the link works
   - Do this on a second device too, to check token-hash links.

## Testing done (staging, no emails sent)

- **PGlite:**
  - code parity with SQL
  - hashes only
  - the open/required switch
  - single use and reuse
  - unknown, expired and revoked codes
  - concurrency (serialized)
  - a failed sign-up not burning a code
  - no exemptions
  - malformed input
  - status list privacy
  - revocation rules, expiry and batch validation
  - account deletion
  - access control and owner guards
- **Live (real Supabase Auth on staging):**
  - direct `/signup` bypass attempts blocked, with no user created
  - the neutral pre-check
  - invite → account (no code stored), unconfirmed accounts unable to sign in, and the confirm callback signing them in
  - reuse rejected
  - 4 truly concurrent sign-ups → 1 account
  - revoked codes and invalid links rejected
  - recovery link → new password works, old one doesn't, the link is single-use
  - access control, and the rate limit
- **Browser (production build):**
  - form fields and labels, malformed, mismatched and unknown codes
  - the neutral "check your inbox" with resend
  - the database refusal message
  - confirmation link → signed in → orientation → a verified round
  - refresh persistence, the invalid-link notice
  - recovery → new password → sign out and in with the new password
  - guest play while invitations are required
  - mobile layout

**Not tested:** real email delivery. No mailbox was used, and no test email was sent. The browser's own `signUp` call was answered locally in the UI test so that no email went out, while account creation through Supabase Auth was tested with admin-generated links.
