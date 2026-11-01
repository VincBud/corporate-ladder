# Pipeline Panic v0.1

The second verified minigame, for the Sales department: end-of-quarter pipeline triage in a fictional CRM ("DealDesk"). It's a 90-second round with 8–10 opportunities, one decision each.

Code: `src/games/pipeline-panic/` (pure, shared by browser and server), `src/server/pipeline/`, `src/apps/pipeline-panic/`.

## Gameplay

Flow: Lobby → Briefing (this round's playbook) → Active pipeline → Submit or time-out → Task Performance Report → Decision Review → Play again.

Each opportunity gets one of four decisions:

- **Close at list**
- **Close with a discount**, in 5% steps from 5% to 25%
- **Next quarter** (defer)
- **Disqualify**

The evidence is split across sources, so the player has to compare them:

| Source | Contains |
|---|---|
| CRM record | contact, list price, delivery cost, expected close date |
| Client email | the client's budget, or that none is committed |
| Discovery notes | whether a decision maker is engaged |
| Contract redlines | requested clauses and payment terms |
| Playbook (varies by round) | quarter end, closing slots, max discount, margin floor, max payment terms, restricted clauses |

The correct decision follows from visible information, checked in this order (`solve.ts`):

1. **Qualified?** A confirmed budget and an engaged decision maker; otherwise disqualify.
2. **Contract allowed?** No restricted clause, and payment terms within the limit; otherwise disqualify.
3. **This quarter?** Closes after quarter end: next quarter.
4. **Price.** If the budget covers list, close at list. Otherwise use the smallest discount step that fits the budget, if it's within the limit and keeps the margin floor; if not, disqualify.
5. **Capacity.** Only `closingSlots` deals can close. The most valuable ones (by price after discount) close; the others wait for next quarter.

Scenario types:

| Type | Difficulty | Correct decision |
|---|---|---|
| Clean close | easy | close at list |
| No budget | easy | disqualify |
| Discount win | medium | close with the smallest fitting discount |
| Discount too deep | medium | disqualify |
| No decision maker | medium | disqualify |
| Payment terms | medium | disqualify |
| Next quarter | medium | defer |
| Margin trap | hard | disqualify: the discount fits the budget but breaks the margin floor |
| Restricted clause | hard | disqualify: an attractive deal with a clause hidden in the redlines |
| Capacity | hard | defer: a good deal, but more valuable deals take the slots |

Difficulty comes from comparing evidence and prioritizing, not from longer text.

## Generation (`generate.ts`)

- **Determinism:** seeded with the shared xmur3/mulberry32 RNG, so the same seed always gives the same round.
- **One rule per opportunity:** each opportunity is built so exactly one rule decides it.
- **Buffers keep answers away from boundaries:**
  - Budgets sit at least 1% of list away from any discount step.
  - Margins are at least 2 points away from the floor.
  - Capacity losers are worth at most 85% of the smallest winner.
- **Composition:** every round contains all four correct actions, between three and four winners plus one or two capacity losers, and at most five blockers, of which at most four are disqualifications.
- **Integrity:** `findIntegrityProblems` checks every round against the independent solver, plus the buffers and the composition. Rounds that fail are regenerated deterministically. Tests run 2,000 seeds: 0 problems, about 0.5 ms per round.

## Scoring (`scoring.ts`)

| Outcome | Points |
|---|---|
| Correct | +80 easy · +100 medium · +130 hard |
| Revenue leakage (winning deal, bigger discount than needed, still within policy) | half points |
| Bad deal (signed a deal that had to be rejected, or broke the discount limit or margin floor) | −50 |
| Prioritization error (closed a deal that had to wait) | −30 |
| Missed opportunity (passed on or under-priced a winning deal) | −45 |
| Misfiled (disqualify and defer mixed up) | −25 |
| No decision | 0 |
| Time bonus | up to +200 × time left × accuracy, only with every decision made and ≥ 80% correct |

- **Final score:** never below 0. The maximum is 950–1,300 points, depending on the scenarios.
- **Blind play doesn't pay** (tested on 500 rounds): any single repeated action scores at most 25% of the maximum (12% on average for "disqualify everything"), and random clicking averages under 10%.
- **Normalization for the shared systems:**
  - **XP:** the shared formula, `floor(score / 20)`, so a perfect fast round earns about 50–65 XP.
  - **Contribution events:** "objectives completed" = correct decisions, "total" = opportunities, "mistakes" = wrong decisions (leakage included).
  - **Grade:** Exceeds (all decided, ≥ 90% correct, no bad deal), Meets (≥ 70%), Needs Improvement (≥ 40%), otherwise HR.

## Request Assistance (`hints.ts`)

One hint per round. It points at the first opportunity, in pipeline order, that is undecided or decided wrongly, and says where to look ("Open X's contract redlines and compare each clause with the playbook"), never what to decide. It doesn't pause the timer and costs no points or XP. As with Reconciliation Rush, the round counts as assisted, and company contribution applies the usual 0.8 factor.

## Verified play

- **Routes:** `POST /api/pipeline/rounds`, `/api/pipeline/rounds/:id/hint`, `/api/pipeline/rounds/:id/submit`.
- **Lifecycle:** the same database functions and guarantees as Reconciliation Rush.
  - The server picks a secret seed (`PP1-` + 128 bits), and the database keeps the clock (90 s plus 3 s tolerance).
  - The client receives every fact but no seed and no scenario labels.
  - The client sends only `{ decisions }`, validated against the round's own opportunities.
  - The server rebuilds the round from the seed and pinned rules version, scores it, and finalizes it exactly once. That one transaction writes the result, the XP row and the contribution event; retries return the stored result.
  - Late submissions beyond the tolerance are scored with no decisions.
- **Game isolation:** each service accepts only sessions of its own game. A Pipeline Panic session sent to the Reconciliation Rush endpoint, or the other way round, is treated as nonexistent (404). `resultRowToRecord` now takes the game id from the stored row.
- **One active round:** a player has one active round across both games. Starting a round in one game abandons an unfinished round in the other.

## Careers and company

- **Sales career:** verified Pipeline Panic rounds are qualifying rounds under the existing career rules: submitted in time, at least 80% correct, each seed once, while a member of Sales. They promote Sales employees to positions 1 and 2. No rule was changed: Sales qualifies automatically because the game feeds a Sales metric.
- **Contribution:** migration `20261101130000_pipeline_panic.sql` adds game rules v1 and contribution formula v1, sending 100% (10,000 bp) to Sales' Pipeline health. Reconciliation Rush formulas and events are untouched.
- **Live Company:** Sales becomes a measured department. The economic formulas and workforce policy are unchanged. The balancing audit in `economy-balance.md` was computed with Reconciliation Rush only and should be rerun.
- **Demo preview:** the planned "Pipeline Triage" game was replaced by Pipeline Panic as the Sales home game.

## Interface

DealDesk CRM inside LadderOS:

- **Layout:** pipeline list with decision chips, opportunity detail (CRM record, email, discovery notes, redlines), decision controls, and a playbook sidebar (a toggle on narrow windows).
- **Round controls:** countdown with an urgency color and screen-reader announcements, progress and closing-slot counters, a hint banner with "Show opportunity", and Submit and Exit confirmations (focus on "Keep working", Escape cancels).
- **Keyboard:** `J`/`K` or `↑`/`↓` move between opportunities, `1`–`4` decide, `[`/`]` change the discount, `0` clears a decision.
- **Responsive and reduced motion:** the list and detail stack on phones; animations respect reduced motion.
- **Report:** score and maximum, grade, satirical feedback, career update (XP), company contribution (Sales, verified rounds), correct decisions, mistakes, missed opportunities, accuracy, time used and remaining, assistance, and an itemized breakdown.
- **Decision Review:** for every opportunity you decided: your decision, whether it was right, the best decision, the explanation with the numbers, the verdict and the points. Opportunities you didn't decide show only their name and "No decision recorded. The opportunity was not evaluated."

## What the review reveals

The review is built once, in `review.ts`, for both verified and guest rounds. It's redacted before it leaves the server (or, for guest rounds, before the UI sees it):

- **Unattempted opportunities:** carry only `{ id, decision: null, kind: "undecided" }`. There's no best decision, explanation, verdict, points or difficulty.
- **Seed and scenario labels:** never part of the review. The manager feedback is chosen on the server.
- **Hints:** included only if they point at an opportunity the player decided.
- **Verified result records** (`record.seed`, also in `GET /api/career`): carry an opaque seed reference (`ref-` + truncated SHA-256), not the secret seed. The seed plus the client-side generator would rebuild every answer.
  - "Each puzzle counts once" checks still work, because the same seed always gives the same reference.
  - XP, replay protection and contribution events are computed in the database from the real seed.
- **Guest rounds:** generated in the browser, so a determined player could inspect memory. The UI still never displays unattempted answers.

Scores, XP, contribution events and career progression are computed from the full round, exactly as before.

Guests play local practice rounds scored in the browser, recorded in this browser only, the same as Reconciliation Rush.
