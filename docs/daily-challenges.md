# Daily Challenges v0.1

The first recurring community competition. Every UTC day, every registered employee gets the same two assignments, with one ranked attempt each:

| Assignment | Game | Id |
|---|---|---|
| Daily Audit | Reconciliation Rush | `daily-audit` |
| Daily Sales Briefing | Pipeline Panic | `daily-sales-briefing` |

Participation is optional. There are no streaks, and nothing happens if you miss a day.

Code: `src/daily/assignments.ts` (definitions), `src/server/daily/service.ts`, `src/app/api/daily/`, `src/apps/daily/` (the **Daily Assignments** app), migration `20261101150000_daily_challenges.sql`.

## Generation

A challenge is one row per assignment and UTC date in `daily_challenges`:

| Field | Value |
|---|---|
| `id` | `<assignment>:<YYYY-MM-DD>`, stable and public. It reveals nothing about the puzzle |
| `game_id`, `challenge_date` | the game and the UTC date |
| `rules_version` | the active rules version when the challenge was created, pinned for the whole day |
| `generation_version` | the generation strategy (currently 1) |
| `seed` | secret |
| `opens_at` / `closes_at` | 00:00 UTC of that day and of the next |
| status | derived: open until `closes_at`, then closed |

**Strategy DC1.**
- **When:** the first request of the day for an assignment creates the row: `insert … on conflict do nothing`, so concurrent requests converge on one row.
- **Seed:** the database draws it from its cryptographic RNG (2 × `gen_random_uuid()`, 244 random bits). It's never derived from the date, so future puzzles can't be computed.
- **Puzzle:** the game's normal generator builds it from that seed and the pinned rules version, so it is deterministic for the whole day.
- **Only today:** challenges are created for the current day only. Anonymous visitors never create rows.

Changing the strategy means adding a new `generation_version` in a migration. Existing challenges keep theirs.

## Participation rules

- **One attempt per player and challenge:** primary key `(challenge_id, user_id)` on `daily_challenge_attempts`.
- **Starting reserves it:** `start_daily_attempt` creates the attempt and the game session in one transaction, under the same per-player lock as every round start.
- **Guests:** they see a preview (date, assignments, reset countdown, practice links) built without the database. They can't start ranked rounds (401).
- **A daily round is an ordinary verified session.** Hints and submissions use the existing endpoints (`/api/rounds/:id/…`, `/api/pipeline/rounds/:id/…`), with the same scoring, deadline (90 s + 3 s tolerance) and exactly-once finalization.
- **Never abandoned implicitly:**
  - **While running:** starting any other round is refused (`409 daily_in_progress`).
  - **Once past its deadline:** the server first settles the round as an official time-out (score 0, cells ignored) and then starts the new round. Settling also happens when the player opens Daily Assignments, so every reserved attempt ends with an official result.
- **Timing:**
  - **Leaving or closing the window:** the server clock keeps running.
  - **Time-outs:** timing out counts as the attempt.
  - **Restarting:** a finished or expired attempt can never be restarted (`409 daily_attempt_used`).
- **Practice is unlimited.** It uses fresh random puzzles that are never the daily one, and a finished daily attempt is never turned into an extra practice round of the same puzzle.

### Retrying a request vs. another attempt

| Action | Result |
|---|---|
| Repeat "start" (reload, second tab, duplicate or concurrent requests) | The **same** session, with its original `startedAt` and deadline (`status: "resumed"`), plus any hint already used. Unsent answers come back from this browser's local draft, if available |
| Repeat "submit" | The stored result, unchanged; no new XP or contribution |
| "Start" once the round is final | `409 daily_attempt_used`. There is no second attempt |

### UTC days and midnight

- **Which day:** an attempt belongs to the challenge of the UTC date on which the server started its session. The server decides this; the browser never does.
- **Rounds running across midnight:** a round started at 23:59:30 can be submitted until its normal deadline after midnight, and its result stays with the earlier day. The new day's challenge is separate, and available once that round is finished.
- **History:** the overview shows today's state and up to 7 recent days, with past days without an attempt shown as *Missed* (information only).

## Fairness and answer protection

The puzzle is shared, so anything that reveals answers to one player reveals them to everyone still to play.

- **Seed placement:**
  - The shared seed lives only in `daily_challenges`, which no API role can read (not even `service_role`).
  - The server gets it through `get_game_session` (as `puzzle_seed`).
  - Each daily session has its own unique session seed (`DS1-…`), and that is what `game_sessions` and `game_results` store. Players can read their own `game_results`, so storing the shared seed there would leak it after the first finisher.
- **Existing protections unchanged:** global session-seed uniqueness, XP replay protection and one contribution per (player, game, seed) all keep working.
- **Sealed review:**
  - Submit responses for daily rounds carry `review: null` and a `daily` link.
  - There are no solutions, no best decisions or explanations, and no per-item verdicts.
  - Otherwise one player could enter garbage everywhere, sacrifice their score and read the full answer key.
  - The player sees only the official totals: score, correct/total, mistakes, time and assistance.
  - The sealing applies whichever endpoint submits the round. Practice reviews (including the Pipeline Panic redaction policy) are unchanged.
- **Records sent to clients:** career records keep an opaque `ref-…` of the per-session seed. Start responses contain only the public puzzle.
- **Other players' rounds:** like any session, they look nonexistent (404).

### Limitations

- **Sharing outside the product:** players can share answers externally (chat, screenshots). Server checks can't prevent this; they only make sure the product itself never discloses them.
- **Pipeline Panic is a logic puzzle:** every fact needed is public by design, so a player can write a solver from the public round. Reconciliation Rush answers come from the source documents, which are also public.
- **Assistance and automation:** outside help can't be detected. The ranking breaks ties against assisted rounds but doesn't exclude them.
- **Expired rounds:** they are settled lazily, when the player next starts a round or opens Daily Assignments. Until then, they don't appear in rankings.

## Results and ranking

The official result is the attempt's verified `game_results` row. There's no second results system. Per player and challenge:

| Data | Fields |
|---|---|
| Identity | challenge id, player, game, UTC date |
| Score | score and maximum |
| Outcome | completion, time used and remaining, assistance |
| Times | attempt start and deadline, completion time |
| Reward | XP awarded |

**Ranking (per challenge; games are ranked separately):**

1. Higher verified score.
2. Less time used.
3. Unassisted before assisted.
4. Earlier completion.
5. Session id (stable final tie-breaker).

Raw scores are compared, because everyone in a challenge has the same puzzle and maximum. Normalization isn't needed and isn't used across games. Only finalized results rank. Test accounts are excluded, except from their own standing.

**v0.1 display:** the player's official result and current standing ("#3 of 12 so far").

**Leaderboard interface (server only, no UI yet):**
- `get_daily_leaderboard(challenge_id, limit)` and `DailyService.leaderboard()` return ranked rows with score, maximum, completion, time, assistance, and `isViewer` for the viewer's own row.
- They contain no names or user ids (the SQL function's user ids stay on the server).
- Whether to show display names belongs to the future social UI.

## XP, careers, contributions, achievements

| System | Daily attempt |
|---|---|
| Corporate XP | Ordinary formula (`floor(score / 20)`), once. No daily multiplier |
| XP replay protection | Unchanged. The per-session seed is unique, so a first daily attempt earns XP, and a player can't attempt the same daily twice |
| Company contribution | One event, like any verified round; quarterly caps and formulas unchanged |
| Department career | Counts as a verified round under the existing rules (submitted, ≥ 80%, during membership, a game that feeds the department) |
| Achievements | Ordinary verified round, plus **Daily Grind** |

**Daily Grind** is now available: complete a ranked Daily Challenge before its timer runs out.
- It's computed on the server from `daily_challenge_attempts` and `game_results` (`get_achievement_facts.dailies`), citing the result as its source.
- Timed-out attempts don't count. The browser can't forge it, and it's awarded once.
- Perfect Quarter stays future.

## Database and security

| Object | Access |
|---|---|
| `daily_assignments` | Read for everyone (reference data). Only `is_active` may change (trigger) |
| `daily_challenges` | **No access for any API role.** Immutable (no update, delete or truncate), even for the owner |
| `daily_challenge_attempts` | Players read their own (RLS). No direct writes for anyone, including `service_role`. Append-only; removed with the account |
| `get_daily_status`, `start_daily_attempt`, `get_active_daily_session`, `get_daily_leaderboard` | `SECURITY DEFINER`, empty `search_path`, `service_role` only |
| `ensure_daily_challenges`, `daily_challenge_entry` | Internal; no API role can execute them |

**Extended functions:**
- `create_game_session`: refuses to abandon a daily round.
- `get_game_session`: adds `puzzle_seed` and `daily`.
- `get_achievement_facts`: adds `dailies`.
- `check_progression_integrity`: adds `daily_attempts_mismatching_session` and `daily_sessions_abandoned`.

The privilege allowlist test includes all of them.

**Account deletion** removes a player's attempts (and their sessions and results, as before). Challenges remain: they contain no player data.

## API

| Route | Who | Returns |
|---|---|---|
| `GET /api/daily` | Anyone | Today's challenges. Signed in: state (Available, In progress, Completed, Timed out), official result, standing, recent days |
| `POST /api/daily/:assignmentId/start` | Signed in | `{ status: started \| resumed, challengeId, gameId, round, hint }`, or `409 daily_attempt_used`, `409 daily_in_progress`, `404 unknown_daily_challenge` |

## Interface

The **Daily Assignments** app (desktop, launcher, mobile):

- **Overview:**
  - The UTC date, a live countdown to 00:00 UTC, and today's two challenge cards.
  - Each card shows: game, description, the one-attempt rule, state badge, official result with standing, and a "Practice …" link that opens the normal game.
  - Recent days (no penalties) and a short "How it works".
- **Start:** an inline confirmation ("the clock starts immediately and keeps running if you leave"). The round then plays in the game's own round screen, under an "Official attempt" banner.
- **Leaving and reloading:** leaving asks first and explains that the clock keeps running. Reopening offers "Resume attempt" with the original deadline.
- **Result:** the official result, XP, and an "Answers stay sealed" note. Achievement toasts wait until the round is over.
- **Guests:** a preview with sign-in and practice links.
- **Desktop icons:** with eight apps, the icon column wraps into a second column only on short screens. The evaluation watermark moved to the bottom right.
