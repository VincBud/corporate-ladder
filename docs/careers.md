# Department careers v0.1

Every registered employee can join one of the nine canonical departments, get a job title in that department's career track, and transfer later.

Three concepts stay separate:

| | What it is | Changes with a transfer? |
|---|---|---|
| **Corporate XP and rank** | Global progression from verified rounds (`career/xp.ts`, `career/ranks.ts`) | Never |
| **Department career** | Department, job title, membership history | Yes; earned positions are kept per department |
| **Company contribution** | Follows the game played (`simulation/games.ts`) | Never: already recorded events are untouched |

## Departments

`src/config/departments.ts` is the only registry: id, name, kind, description, introduction, responsibilities and extra planned games. The Supabase `departments` table must match id, name and kind (a test checks this).

| id | Name | Kind |
|---|---|---|
| `finance` | Finance | operating |
| `controlling` | Controlling | operating |
| `people` | Human Resources | operating |
| `sales` | Sales | operating |
| `operations` | Operations & Supply Chain | operating |
| `it` | IT & Engineering | operating |
| `marketing` | Marketing | operating |
| `legal` | Legal | support |
| `strategy` | Corporate Strategy | support |

Every department can be joined, including those without a live game. Planned games are labelled as planned.

## Career tracks

`src/career/department-tracks.ts` defines 7–8 positions per department, from intern to the executive suite:

| Department | Track |
|---|---|
| Finance | Finance Intern → Junior Analyst → Analyst → Senior Analyst → Associate → Vice President → Managing Director → Chief Financial Officer |
| Controlling | Controlling Intern → Junior Controller → Controller → Senior Controller → Controlling Manager → Head of Controlling → Chief Financial Officer |
| Human Resources | HR Intern → HR Assistant → Recruiter → HR Business Partner → HR Manager → HR Director → Chief Human Resources Officer |
| Sales | Sales Intern → Sales Development Representative → Account Executive → Senior Account Executive → Sales Manager → Sales Director → VP Sales → Chief Revenue Officer |
| Operations & Supply Chain | Operations Intern → Operations Coordinator → Supply Chain Analyst → Logistics Specialist → Operations Manager → Director of Supply Chain → Chief Operating Officer |
| IT & Engineering | IT Intern → Service Desk Technician → Junior Engineer → Software Engineer → Senior Engineer → Engineering Manager → Director of Engineering → Chief Technology Officer |
| Marketing | Marketing Intern → Marketing Coordinator → Content Specialist → Brand Manager → Senior Brand Manager → Marketing Director → Chief Marketing Officer |
| Legal | Legal Intern → Paralegal → Associate Counsel → Corporate Counsel → Senior Counsel → Deputy General Counsel → General Counsel |
| Corporate Strategy | Strategy Intern → Business Analyst → Strategy Associate → Strategy Manager → Director of Strategy → VP Corporate Strategy → Chief Strategy Officer |

Each position also has a one-line job description.

## Progression policy v0.1

Positions are **derived** from verified data every time; none are stored or granted.

- **Entry:** every new member starts at position 0.
- **Positions 1 and 2:** earned with 3 and 10 **qualifying verified rounds** of a live game that feeds the department's metrics, completed while a member of that department.
  - **Qualifying:** submitted in time, at least 80% of discrepancies fixed. Each puzzle seed counts once.
  - **Which game feeds which department** comes from the contribution configuration. Reconciliation Rush feeds Controlling and Finance, so today only those two departments can progress.
- **No live game yet** (Human Resources, Sales, Operations, IT, Marketing, Legal, Corporate Strategy): the department stays at its entry position, and the track shows the planned games. Global Corporate XP never grants department titles.
- **Positions 3 and up:** require Quarterly Performance Reviews, which aren't implemented. The track says so.
- **Why Reconciliation Rush can count:** it uses only server-verified results the player already owns. It doesn't create a second XP economy and doesn't touch contribution or XP.

## Membership and transfers

- **First selection:** immediate and free.
- **Cooldown:** 30 days after joining the current department. The database checks it with its own clock (`select_department`). The client only sends the department and a request id; extra fields such as timestamps are ignored.
- **Duplicate submissions:** the same request id returns the original result (`duplicate`).
- **Concurrent requests:** serialized by a row lock on the profile. Only one can change the department.
- **What a transfer keeps:**
  - Corporate XP, rank, verified rounds and contribution events stay untouched.
  - The previous membership is closed and kept in the history.
  - Positions earned in a department count again on return: rounds from every membership period in that department add up.
- **Joining or transferring** also updates `profiles.department_id` in the same transaction. The Live Company workforce counts reflect it at once, because the server invalidates its snapshot cache. The company's financial model doesn't use membership.

## Database (migration `20261101120000_department_membership.sql`)

| Object | Rules |
|---|---|
| `department_memberships` | One row per period: user, department, `started_at`/`ended_at` (database time), start reason (`initial`, `transfer`, `legacy`), end reason, request id (unique), id. At most one open period per player (unique index), no overlapping periods (insert trigger), a period can be closed once and never changed otherwise, deleted only with the player's account. RLS: players read their own rows; no client writes. |
| `profiles.department_id` | Still the single "current department" field. A trigger only allows the department of the open membership. Players and the service role lost direct UPDATE on it. |
| `select_department()` | SECURITY DEFINER, service role only. Joining, transferring, cooldown, idempotency, locking. |
| `check_progression_integrity()` | Adds `profiles_department_mismatch` and `overlapping_memberships`. |

Existing department assignments became `legacy` memberships (staging had none). "Strategy" is displayed as "Corporate Strategy"; the id is unchanged.

## API

- `POST /api/department` `{ departmentId, requestId }`. Signed-in players only. Returns `joined`, `transferred` or `duplicate`, or one of these errors:
  - `401` signed out
  - `400 unknown_department`, `400 invalid_payload`
  - `409 already_member`, `409 transfer_cooldown`
  - `429` rate limited
- `GET /api/career` now includes `departmentCareer`: the current membership, history, next transfer date, whether a transfer is possible now, and progress per department worked in.
- `PATCH /api/profile` no longer accepts `departmentId` (400).

## Player experience

- **Departments app:** browse all nine departments, with an introduction, responsibilities, career track, available and planned games and privacy-filtered headcount. Join or transfer with a confirmation that shows the starting position and the cooldown. Guests can preview but not join.
- **Onboarding:** signed-in employees without a department see an optional, dismissible desktop invitation. Play is never blocked.
- **Corporate Career:** a Department Career panel shows the current title, the track with the current position highlighted, the next promotion and its requirement, transfer availability, membership history and kept positions. Corporate rank stays separate ("company-wide").
- **Employee Profile:** department, job title, rank, Corporate XP and join date, with links to the department career and transfers.
