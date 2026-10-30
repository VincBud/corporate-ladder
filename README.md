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
  career/              Ranks, XP curve, achievements (pure functions)
  services/            Data access layer — the only place backends get wired in
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

A single round must never be treated as a quarterly review, and rounds don't award Corporate XP yet. The report shows an XP preview that is explicitly not saved.

## Status

LadderOS desktop shell with four applications. Reconciliation Rush v0.1 is playable (solo, not persisted). No backend or authentication yet. Leaderboard data is fictional and labeled as such.
