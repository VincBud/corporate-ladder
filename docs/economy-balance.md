# Live economy: balancing audit

Status: **analysis and proposal for review. The production formulas are unchanged.**

> Computed with Reconciliation Rush as the only live game (`AUDIT_RULES` in `balance.ts`). Since Pipeline Panic, Sales is measured too: the ceiling is higher (+6% revenue from Sales) and the scenarios should be rerun before the proposal is adopted.

Every number here comes from the real engine (`computeQuarter`) via `src/simulation/balance.ts`. `src/simulation/balance.test.ts` pins down the current behavior and the proposal's properties. All money is fictional CorpBucks (CB) per quarter.

## Current model (production)

From `src/simulation/live.ts`:

- **Baseline:** revenue 16.0M, costs 16.708M, so an operating loss of −708K with nobody playing.
- **Live play:** feeds two metrics. Reconciliation Rush splits 70% to Controlling (Ledger integrity) and 30% to Finance (Close quality).
- **Targets:** registered employees × staffing share × 120 points. Controlling's share is 38/444 = 8.6%, Finance's 52/444 = 11.7%.
- **Attainment:** capped at 150%, with half the effect above 100%.
- **Ceiling:** +2.5% revenue and −3.375% costs give an operating profit of **+256K**. The full swing from baseline to ceiling is 964K.

### Scenarios

"Points" means credited points per active employee in the quarter. One perfect round is about 100; the player cap is 400.

| Registered · active · points | Current: Controlling / Finance attainment | Current op. profit | Proposed attainment (both) | Proposed op. profit |
|---|---|---|---|---|
| 0 · 0 · 0 | not measured | −708K | 0% | −708K |
| 1 · 1 · 100 (one strong round) | 150% / 150% | **+256K** | 8% | −644K |
| 1 · 1 · 400 (solo, capped) | 150% / 150% | +256K | 33% | −451K |
| 10 · 1 · 100 | 68% / 21% | −351K | 8% | −644K |
| 10 · 10 · 100 | 150% / 150% | +256K | 83% | −65K |
| 100 · 20 · 300 | 150% / 128% | +216K | 50% | −322K |
| 1,000 · 50 · 300 | 102% / 32% | −177K | 13% | −612K |
| 1,000 · 100 · 300 | 150% / 64% | +36K | 25% | −515K |
| 1,000 · 500 · 300 | 150% / 150% | +256K | 125% | +160K |
| 100,000 · 10,000 · 300 | 150% / 64% | +36K | 25% | −515K |
| 100,000 · 100,000 · 400 | 150% / 150% | +256K | 150% | +256K |

### Participation sweep (1,000 registered)

| Participation | Current, 1 round (100) | Current, 3 rounds (300) | Proposed, 1 round | Proposed, 3 rounds |
|---|---|---|---|---|
| 0% | −708K | −708K | −708K | −708K |
| 5% | −530K | −177K | −676K | −612K |
| 10% | −351K | +36K | −644K | −515K |
| 22% | −26K | +239K | −567K | −284K |
| 30% | +36K | **+256K (ceiling)** | −515K | −130K |
| 50% | +178K | +256K | −387K | +160K |
| 75% | +256K | +256K | −226K | +256K |
| 100% | +256K | +256K | −65K | +256K |

## Findings

| Area | Current behavior | Assessment |
|---|---|---|
| **Zero players** | Baseline loss, labelled "seeded baseline" in the app | Fine |
| **Low player counts** | One strong round by a solo employee reaches the ceiling (−708K → +256K) | **Too volatile.** A single round decides the company |
| **Scale (1 → 100,000)** | Results depend only on ratios (active/registered, points), so they're identical at 10, 1,000 and 100,000 employees; arithmetic is exact and bounded | Fine |
| **Department concentration** | Targets follow staffing shares, but points follow the game. With three strong rounds per active employee, Controlling saturates at about 7% participation and Finance at about 23% | **Lopsided.** Finance looks weak although it isn't |
| **Player caps** | 400 points per player per quarter; grinders can't carry the company | Works, but saturation usually happens before caps matter |
| **Participation** | Profit saturates at about 30% participation (3 rounds) or 75% (1 round); more play changes nothing | **Flat too early.** Little reason for broad engagement |
| **Long-term stability** | Each quarter starts at the same baseline; no compounding, inflation or growth. Profit always stays in [−708K, +256K] | Stable and bounded. No growth story yet (fine until quarter close exists) |
| **Dormant accounts** | Targets grow with *registered* employees, so inactive accounts make targets harder over time | Hidden today by early saturation; matters once saturation is fixed |
| **Server cost at scale** | The snapshot reads every event of the quarter into the server | OK for thousands of rounds; at 100,000 active players (~300K events) aggregation must move into SQL |

## Proposal (for review, not applied)

Implemented only in `balance.ts` (`proposedLiveConditions`, `PROPOSED_BALANCE`), unused by production.

1. **Allocation-aware targets.** Department target = workforce × 120 points × the department's share of live gameplay (from the games' metric weights; Rush: Controlling 70%, Finance 30%). 100% attainment then means the average employee earned 120 credited points (about 1.2 strong rounds), and Controlling and Finance move together.
2. **Workforce floor of 10.** Targets assume at least 10 employees, so one strong round in a tiny company is visible (+64K) but not decisive. A solo employee at the cap stays below break-even.
3. **Workforce basis: decision needed.**
   - **Registered employees** (as today and in the simulated proposal): participation matters, but dormant accounts dilute targets forever.
   - **Active employees** (`proposedActive` variant): no dilution, but profit then depends only on the average active player. At 100,000 employees, 1% participation with three rounds each reaches the ceiling, so participation no longer matters for profit.
   - **Recommended:** "recently active" employees (at least one verified round in the current or previous two quarters). Dormant accounts drop out after about six months while participation still matters. This needs a small SQL change in `get_company_quarter` and a model version bump.

Effect of 1 + 2 (registered basis):
- **Break-even:** needs about 92% attainment, i.e. ~110 credited points per registered employee, e.g. about 37% of employees playing three strong rounds each.
- **Unchanged:** the zero-player baseline, the ceiling and the player caps.
- **Scale:** results stay scale-invariant above the floor.

Adopting it would mean:
- switching `buildLiveSnapshot` to the new conditions and bumping `ECONOMY_MODEL_VERSION` (2)
- updating `live.test.ts` and the live tests' expectations
- documenting it in `simulation.md`

No stored data changes: events keep their inputs, and snapshots aren't stored yet.

## Not proposed (yet)

- **Market growth or inflation:** would invent operating history. Wait for quarter close and finalized reports.
- **More departments:** concentration in Controlling and Finance is structural until another live game feeds other metrics. The engine already supports it through configuration.
