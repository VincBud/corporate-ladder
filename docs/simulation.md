# Corporate Simulation v0.1

Every player will eventually work for one fictional company, **Consolidated Synergy Holdings**. Verified minigame rounds feed its operational metrics, which drive its quarterly financials and earnings reports.

This version is the foundation: a pure, deterministic engine (`src/simulation/`), a Company dashboard app, and a clearly labeled **simulation preview** that uses demo data. There is no shared company on the server yet, and nothing in this feature writes to Supabase.

## Data flow

```
Verified game result      game_results row, scored by the server (Backend Foundation, live)
  → Normalized contribution  contribution.ts   quality × difficulty × completion × assistance, player caps, replay/duplicate checks
  → Department metrics       economy.ts        credited points vs. size-scaled targets
  → Company state            economy.ts        revenue, costs, profit, efficiency
  → Quarterly earnings report report.ts        built per quarter, finalized and frozen once the quarter closes
```

`simulate.ts` runs the whole chain across consecutive quarters, and `source.ts` defines the contract for the future server.

## Modules

| File | Purpose |
|---|---|
| `types.ts` | `ContributionEvent` (no XP field), department ids, periods, provenance |
| `departments.ts` | Seven departments and their operational metrics (configuration) |
| `games.ts` | Which metrics each minigame feeds. Live: Reconciliation Rush. Planned games exist only in the preview |
| `contribution.ts` | Validation, normalization, player caps, duplicate and seed-replay rejection |
| `economy.ts` | Quarterly financial model |
| `milestones.ts` | Company milestones (configuration) |
| `report.ts` | Earnings reports, satirical management statements, finalization |
| `decisions.ts` | Planned strategic decisions (engine supports their effects; no voting) |
| `simulate.ts` | Multi-quarter runner |
| `source.ts` | Server snapshot contract, snapshot validation, verified-result adapter |
| `demo/scenarios.ts` | **Demo data** generator for the preview |

## Contribution normalization

XP and company contribution are separate. XP rewards the individual (`floor(score / 20)`, uncapped). Contribution measures useful work for the company, and is normalized and capped.

Per round:

```
scoreShare = score / maxScore
resolution = objectivesCompleted / objectivesTotal          (Rush: errors fixed / 5)
precision  = objectivesCompleted / (completed + mistakes)    (0 when nothing was attempted)
quality    = 0.4·scoreShare + 0.4·resolution + 0.2·precision ∈ [0, 1]
points     = round(100 · quality · difficulty · completion · assistance)
             completion: submitted 1.0, timed out 0.75
             assistance: unassisted 1.0, assisted 0.8
             difficulty: per game (Rush "associate" 1.0; planned "senior" 1.25)
```

Per player and quarter, in completion order: full credit up to **300** points, half credit above that, never more than **400**. That is about three strong rounds at full value, and nothing more counts after roughly five rounds. Running totals are rounded, so a player's credits always sum to the capped total exactly.

Rejected events (each with a reason):

- **Invalid:** non-finite numbers, score outside `[0, maxScore]`, `maxScore` ≤ 0, more objectives than exist, non-integer counts, bad timestamps or ids.
- **Wrong provenance:** live runs accept only `server-verified` events; the preview accepts only `demo` events, so the two can never mix.
- **Configuration:** unknown game, planned game outside the preview, unsupported scoring version, unknown difficulty.
- **Outside the period.**
- **Duplicate event id**, in any quarter.
- **Seed replay:** a player earns contribution once per (game, seed), in any quarter.

**Attribution follows the work, not the story.** Reconciliation Rush feeds Ledger integrity (Controlling, 70%) and Close quality (Finance, 30%), whatever business the ledger is themed after. A "Marketing" ledger is still reconciliation work, and it says nothing about the player's department.

## Economic model

All money is whole CorpBucks (CB), fictional.

```
Metric target        = department headcount × targetPerHead (120)
Metric attainment a  = min(1.5, credited points / target)     (null when no configured game feeds the metric)
Effect e(a)          = a up to 1, then half rate above target  (max 1.25)

Revenue              = baseRevenue × (1 + Σ revenueLift·e(a)) × Π decision revenue multipliers
Base costs           = (Σ headcount × costPerHead + 2.5M overhead) × costIndex
Operating expenses   = base costs × (1 − Σ costSaving·e(a)) × Π decision cost multipliers
Operating profit     = revenue − operating expenses
Profit margin        = operating profit / revenue               (null when revenue is 0)
Net profit           = operating profit − 25% tax on positive profit

Execution            = headcount-weighted mean of min(1, department attainment)
Participation        = min(1, active contributors / employees)
Balance              = 1 − std.dev/mean of department attainment (needs ≥ 2 measured departments)
Operating efficiency = 100 × (0.5·execution + 0.3·participation + 0.2·balance)
```

At 100% attainment everywhere, all metrics together add 18% revenue and save 6% costs. Sales and Marketing drive revenue, while support functions mostly save costs.

Design choices:

- **Zero participation is safe.** The company runs at base revenue and costs, so nothing breaks or divides by zero, but costs creep up over time.
- **Size normalization.** Bigger departments have bigger workloads, so they need more output for the same attainment.
- **Saturation.** Attainment caps at 150% with diminishing effect above 100%, so piling everyone into one game saturates one department (see the "Department imbalance" scenario). Balance and efficiency reward spreading work across departments.
- **Breadth over hours.** Player caps plus the participation term mean many casual players beat a few grinders.
- **Versioned.** `ECONOMY_MODEL_VERSION` and `report.modelVersion` record which formulas produced a report, so stored reports are never recomputed under new rules.

## Departments

Finance, Controlling, Human Resources, Sales, Operations & Supply Chain, IT & Engineering, Marketing. Each defines an id, a name, a description, gameplay categories, cost per head, metrics, a future career path (`status: "planned"`) and a dashboard representation.

Adding a department: add its id to `DEPARTMENT_IDS`, a definition and at least one metric. Adding a minigame: add a `GameContributionRule` to `games.ts`; `findRuleProblems` checks the configuration.

The ids are the canonical department ids (`src/config/departments.ts`), shared with the Supabase `departments` table: `finance`, `controlling`, `people`, `sales`, `operations`, `it`, `marketing` are operating departments; `legal` and `strategy` are support departments with no metrics yet. See [backend.md](backend.md#canonical-departments).

## Earnings reports

`buildEarningsReport` produces revenue, operating expenses, operating profit, margin, net profit, growth versus the previous quarter (null without a usable previous quarter), department contributions, milestones reached that quarter, and a management statement.

- **Statements** come from fixed templates by tone: quiet, loss, record, strong, soft or steady. A hash of the report id picks the template, so the same report always gets the same text. No AI or external APIs are involved.
- **Finalization:** `finalizeEarningsReport` returns a deep-frozen copy and refuses a second finalization. In a run, every closed quarter is finalized at the start of the next one, and the latest quarter remains a draft.
- **No scheduled jobs exist yet.**

## Live company

The Live company tab shows the real shared company from `GET /api/company` (see [backend.md](backend.md#live-company)). It uses the same engine as the preview, with `src/simulation/live.ts` supplying the inputs:

| Input | Live definition (v0.1) |
|---|---|
| Baseline | Seeded and fictional: base revenue 16.0M CB per quarter, costs of the `STAFFING_PLAN` roles plus overhead (16.71M CB). No market growth or inflation. Roles are a cost structure, never counted as employees. |
| Employees | Registered player profiles, excluding test accounts. |
| Active employees | Employees with at least one verified round this quarter. Each counts once. |
| Contributing | Active employees whose rounds earned points (> 0). |
| Department membership | `profiles.department_id`, or "no department yet". Shown only as privacy-filtered counts. It never affects attribution or targets. |
| Target headcount | Registered employees × the department's share of `STAFFING_PLAN` (Controlling 38/444, Finance 52/444, …), fractional. Zero employees means no targets, so nothing is measured. |
| Participation | Contributing ÷ registered employees. |

What active players change:

- **Revenue and expenses:** only through department attainment, as incremental lift and savings on the baseline. Live play feeds Controlling and Finance only, so the maximum effect is +2.5% revenue and −3.4% costs (about +0.97M CB operating profit, enough to turn the baseline's −0.71M loss into a small profit).
- **Profit:** revenue − expenses, minus 25% tax on positive profit.
- **Efficiency:** execution (measured departments), participation and balance, as in the preview.
- **Department targets:** grow with registered employees, so one strong round moves a tiny company a lot and a large company a little.
- **Growth:** none is assumed. There are no quarter-over-quarter comparisons until a quarter is closed and its report finalized.

A balancing audit of this model (1 to 100,000 employees, participation, concentration, stability) and a proposal for review are in [economy-balance.md](economy-balance.md). The production formulas above are unchanged.

With no activity, the snapshot is marked `noActivity` (or `noEmployees`) and the app labels the figures as the seeded baseline, not operating results. Milestones are evaluated for the current quarter only. Snapshots carry `reports: []` and are ready for finalized reports once quarter closing exists.

## Simulation preview

The Company app has two views:

- **Live company:** described above. It never falls back to demo data.
- **Simulation preview:** six quarters of a reproducible fictional company, marked as demo data in the notice, the section badge and the report banner. Nothing in it is saved or sent anywhere.

**Developer scenario lab** (only when `NODE_ENV === "development"`): switch between Business as usual, Strong performance, Weak performance, Rapid growth, Department imbalance, Low participation and High participation, and reroll the seed. It shows how many replays and duplicates were rejected and how many points the player caps removed. Production builds show only the default scenario.

## Future server integration

`source.ts` defines:

- **`CompanySnapshot`:** what `GET /api/company` publishes: aggregates, privacy-filtered membership, baseline vs. live financials, departments, milestones, and (later) finalized reports.
- **`CompanyDataSource`:** the read-only source; the browser uses `services/company-source.ts`.
- **`parseCompanySnapshot`:** validates untrusted snapshot JSON and rejects demo or draft reports and impossible counts.
- **`ContributionEventRow` / `contributionEventFromRow`:** a stored `contribution_events` row and its mapping to the engine's event (event id = round id, formula version pinned).
- **`contributionEventFromVerifiedResult`:** maps a server-scored `game_results` record to an event and ignores `xpAwarded`.

**Done:** contribution events for every verified round (Verified Company Contributions v0.1) and the live snapshot endpoint (Live Company v0.1).

Still needed:

1. **Quarter close:** a scheduled, idempotent job that computes the closed quarter with `buildLiveSnapshot`, builds the report with `buildEarningsReport`, finalizes it and stores it once in a new read-only table. Snapshots then carry finalized reports and quarter-over-quarter growth.
2. **Department membership rules,** for example switching cooldowns, and membership history if departments should ever affect results.
