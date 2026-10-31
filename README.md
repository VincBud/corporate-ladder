# Corporate Ladder

> Get promoted for doing nothing. Get hired for doing something.

A browser-based corporate satire gaming platform, presented as **LadderOS**, a fictional enterprise operating system.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
npm test         # Vitest: game logic
npm run build
```

### Backend (optional)

Without configuration the app runs guest-only. To enable accounts and server-verified play, follow [docs/backend.md](docs/backend.md): create a Supabase project, apply `supabase/migrations`, and fill in `.env.local` from `.env.example`.

## Project structure

```
src/
  app/                 Routes, root layout, global CSS + design tokens (@theme)
  apps/                Desktop applications (one folder per app) + registry
    registry.ts        Single source of truth for app metadata and components
  desktop/             The OS shell
    window-manager.ts  Pure reducer for open/close/focus/minimize/maximize/move
    components/        Desktop, WindowFrame, Taskbar, Launcher, SystemTray, …
  games/               Game logic, framework-agnostic (no React imports)
    spreadsheet-wars/
      formula.ts       Safe formula engine (tokenizer + parser, no eval)
      reconciliation-rush/
        generate.ts    Seeded challenge generation + integrity checks
        validate.ts    Final-state answer validation
        scoring.ts     Game score (not XP)
        report.ts      Task Performance Report grade/feedback, XP preview
        machine.ts     Lobby → briefing → playing → results state machine
        result.ts      Finished round → career history record (no answer keys)
  career/              Ranks, XP curve, XP awards, promotions (pure functions)
  simulation/          Corporate Simulation: contributions, economy, earnings reports (pure functions)
  performance/         Player history: schema, ledger, stats selectors, store + hook
  auth/                Browser auth state (Supabase email + password)
  server/              Trusted server code: verified rounds, career API helpers
  services/            Data access layer — the only place backends get wired in
    career-repository.ts  Career persistence interface + localStorage adapter
  mocks/               Clearly labeled mock data (never presented as live)
  components/          Shared UI primitives, icons and brand marks
  config/              Fictional brand identity
  lib/                 Small utilities and generic hooks
  types/               Shared domain types
```

### Conventions

- **Logic stays out of UI.** `games/`, `career/` and `desktop/window-manager.ts` are pure TypeScript so they can later run on the server (score validation, matchmaking) and be unit-tested in isolation.
- **Services own data access.** Components never import from `mocks/` directly. Swapping mocks for Supabase/Postgres happens inside `services/`.
- **Adding an app:** add its id to `types/app.ts`, create `apps/<id>/`, and register it in `apps/registry.ts`. It then appears on the desktop, in the launcher and in the taskbar automatically.
- **Hydration safety.** The route is prerendered (Cache Components is enabled). Anything time-dependent, such as the clock, reads through `useSyncExternalStore` with a `null` server snapshot. Never call `Date.now()` or `new Date()` during render.
- **Design tokens** live in `src/app/globals.css` (`--color-surface`, `--color-fg-muted`, `--color-accent`, `--color-gold`, …) and are used as Tailwind classes (`bg-surface`, `text-fg-muted`).

## Reconciliation Rush

The first playable game, inside Spreadsheet Wars. Fix five errors in a 12–20 row ledger within 90 seconds, using invoices, purchase orders, expense reports and a finance memo as evidence.

- **Generation:** each round has a seed (e.g. `RR-7K2Q9X`). The generator builds a consistent ledger from one of four department templates, then plants exactly five errors across four categories (data entry, calculation, formula, reconciliation). The same seed always produces the same challenge.
- **Validation:** only the final committed sheet is scored. Each editable cell is evaluated in isolation inside an otherwise-correct sheet, so equivalent answers (a value or a formula) count, and one mistake is never counted twice.
- **Security note:** the challenge, including its solution, lives in the browser and can be inspected. That's fine for solo play. Competitive modes must regenerate the challenge from the seed and validate submitted entries on the server. The pure modules are designed to run there unchanged.

## Terminology: Task Performance Report vs. Quarterly Performance Reviews

- **Task Performance Report:** the results screen after a single minigame round (score, grade, manager feedback). It is short-term feedback and saves nothing.
- **Quarterly Performance Reviews (planned, not implemented):** recurring career appraisals at the end of real calendar quarters (Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec). They will drive long-term progression: promotion eligibility, bonuses, objectives and manager conversations.

A single round must never be treated as a quarterly review. Rounds award Corporate XP, which feeds the existing rank ladder, but they never count as an appraisal.

## Corporate progression

The layers are kept separate so new minigames and a server backend can be added without a redesign:

1. **Game scoring:** each game's own rules (e.g. `reconciliation-rush/scoring.ts`).
2. **XP calculation:** `career/xp.ts`. 1 XP per 20 score points, rounded down. A seeded case pays out only once.
3. **Career progression:** `career/progression.ts` and `career/ranks.ts`. The existing level curve and rank ladder; a promotion is a rank change.
4. **Performance history:** `performance/`. Versioned records, an idempotent ledger keyed by session id, and stats selectors.
5. **Persistence:** `services/career-repository.ts`. An async repository interface. Today it's localStorage; later it becomes server-backed.

Total XP is derived from the history (the employee's starting XP plus the XP of each recorded round), so there is no separate counter to drift. Personal bests are compared as a share of the round's maximum score, and only within the same game, difficulty and scoring version.

Progress is saved in this browser only. This is solo progression, not a security boundary: anyone can edit their own localStorage.

## Corporate Simulation

The **Company** app is the company dashboard: revenue, costs, profit, efficiency, department performance, milestones, quarterly history and earnings reports. Verified rounds feed one shared company through normalized, capped contribution points that are separate from XP. The **Live company** tab shows that company from `GET /api/company`; the **Simulation preview** tab shows clearly labeled demo scenarios. Formulas, anti-farming rules and the server contract are in [docs/simulation.md](docs/simulation.md); the balancing audit is in [docs/economy-balance.md](docs/economy-balance.md).

## Department careers

Employees join one of nine departments in the **Departments** app, get a job title from that department's career track, and can transfer after 30 days. Department careers are separate from Corporate XP and never affect company contribution. See [docs/careers.md](docs/careers.md).

## Status

LadderOS desktop shell with six applications. Reconciliation Rush is playable: guests are scored in the browser, and signed-in players get server-verified rounds and XP (see [docs/backend.md](docs/backend.md)). Verified rounds are recorded as append-only company contribution events, and the Company app's Live view shows the shared company computed from them (fictional CorpBucks, aggregate-only). The Simulation preview tab keeps the demo scenarios. Leaderboard data is fictional and labeled as such.
