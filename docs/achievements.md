# Achievements v0.1

Server-authoritative achievements for signed-in players, earned only from verified data. Guests see a preview and earn nothing.

Code: `src/career/achievements.ts` (registry and pure evaluator), `src/server/achievements/service.ts`, `src/achievements/toast-queue.ts`, `src/apps/achievements/`, migration `20261101140000_achievements.sql`.

## Registry

Each achievement has a stable id, name, description, category, icon, rarity, display order and status (`available` or `future`). Some also have a progress target. Rarity is assigned by design; it isn't measured from how many players have the achievement.

| Achievement | Category | Rarity | Unlocks when | Progress |
|---|---|---|---|---|
| First Assignment | Gameplay | Common | First verified round | — |
| Clean Audit | Gameplay | Uncommon | Reconciliation Rush round with every discrepancy fixed | — |
| Deal Maker | Gameplay | Common | Pipeline Panic round with at least 5 correct decisions | — |
| Sales Excellence | Gameplay | Rare | Perfect Pipeline Panic round | — |
| No Assistance Required | Gameplay | Rare | Perfect round, submitted, without Request Assistance | — |
| Ahead of Schedule | Gameplay | Epic | Perfect round with at least half the clock left | — |
| Cross-Functional | Gameplay | Uncommon | Verified rounds in both games | 2 games |
| Welcome Aboard | Career | Common | First department membership | — |
| Climbing the Ladder | Career | Uncommon | First department promotion (3 qualifying rounds) | 3 |
| Middle Management | Career | Rare | Second promotion (10 qualifying rounds) | 10 |
| Getting Started | Career | Common | 10 verified rounds | 10 |
| Corporate Veteran | Career | Epic | 50 verified rounds | 50 |
| Reconciliation Specialist | Department | Uncommon | 5 qualifying Reconciliation Rush rounds, each puzzle once | 5 |
| Quota Crusher | Department | Uncommon | 5 qualifying Pipeline Panic rounds, each puzzle once | 5 |
| Internal Mobility | Department | Uncommon | First department transfer | — |
| Team Player | Company | Common | First verified company contribution event | — |
| Quarterly Contributor | Company | Rare | Contribution events in 2 different quarters | 2 quarters |
| Daily Grind | Gameplay | Common | A ranked Daily Challenge submitted before its timer runs out (see [daily-challenges.md](daily-challenges.md)) | — |
| Perfect Quarter | — | — | **Future:** Quarterly Performance Reviews | — |

Definitions:

- **Perfect:** every error fixed or decision correct, no wrong corrections, submitted in time.
- **Qualifying:** the department career definition. Submitted, at least 80% correct, and counted once per puzzle (seed reference).
- **Promotions:** computed with the department career's own rules (qualifying rounds, during the membership, in a game that feeds the department). A test checks that they agree with `departmentProgress`. Departments with no game can't promote yet.
- **Future achievements:** shown as "Coming later" and rejected by the database until their status becomes `available` in a migration.

**Adding an achievement:** add it to the registry and evaluator, then add a migration that inserts the definition. A PGlite test fails if the two disagree.

## Unlocking and persistence

1. After every verified submission (either game), department change and career load, the server calls `get_achievement_facts`. It returns the player's verified results, memberships, contribution events and existing unlocks.
2. The pure evaluator decides what is earned, when, and from which source record.
3. `award_achievements` inserts only the missing unlocks.

Guarantees:

- **Trusted sources only:** nothing comes from the client. Unlock requests don't exist, and local or guest data is never read.
- **Exactly once:** one row per player and achievement (primary key). `ON CONFLICT DO NOTHING RETURNING` reports only rows actually created, so retries and concurrent requests never duplicate an unlock or its notification.
- **Source checks:** the database verifies that each cited source (result, membership or contribution event) belongs to the player. It also rejects unknown and future ids, and dates an unlock no later than now.
- **Backfill and recovery:** every career load re-evaluates. History from before v0.1, or an award that failed after a submission, is picked up on the next load, dated when it was earned. Failures never break a submission: the response simply carries no new unlocks.
- **Scoring untouched:** XP, scoring, contribution calculations and company economics are not changed or read for writing.

## Database and security

| Object | Access |
|---|---|
| `achievement_definitions` (id, category, rarity, status) | Read for everyone. Immutable except `status` (trigger) |
| `player_achievements` (user, achievement, `unlocked_at`, source type and id) | Players read their own (RLS). No direct writes for anyone, including `service_role`. Append-only trigger, even for the owner. Removed with the account (cascade) |
| `get_achievement_facts`, `award_achievements` | `SECURITY DEFINER`, empty `search_path`, `service_role` only |

The privilege allowlist test (`server/security.test.ts`) includes the new objects.

## Interface

- **Employee Profile:**
  - all achievements, with unlocked dates, rarity and progress bars for locked ones
  - "Coming later" for future ones
  - category filters (accessible toggle buttons)
  - the profile stat `unlocked / available`
  - Guests see the locked list with an explanation.
- **Corporate Career:** the three most recent unlocks and "View all achievements", which opens the Profile.
- **Notifications:** a LadderOS toast with the icon and name (`role="status"`, auto-dismiss after 7 s, animation only with `motion-safe`).
  - **Timing:** toasts are held while any app has an active round (or a submission in flight) and appear after it.
  - **What triggers one:** only unlocks the server just created, so a refresh, a retried request or another device never repeats one.

## Limitations

- **Cost per load:** the evaluator reads the player's full verified history on every career load. That's fine for thousands of rounds; heavy players would need incremental evaluation or a summary table.
- **Policy changes:** if the department career policy changes later, unlocks already earned stay.
- **Missed toasts:** an unlock created during a request whose response never arrives (for example, the tab closed) gets no toast. It still appears in the Profile.
- **Rarity:** fixed by design, not based on unlock statistics.
- **Guests:** guest practice and imported legacy history never count.

## Prepared for later (not implemented)

- **Schema:** `status = 'future'` and `futureSource` (e.g. `quarterlyReview`) mark achievements whose mechanics don't exist yet. Daily Grind was activated this way when Daily Challenges shipped (migration `20261101150000`).
- **New categories and sources:** these can be added for Daily/Weekly Challenges, Quarterly Performance Reviews, department-specific achievements, community milestones and special events, by extending `source_type` and `get_achievement_facts`.
