# Corporate Ladder

> Get promoted for doing nothing. Get hired for doing something.

A browser-based corporate satire gaming platform, presented as **LadderOS**, a fictional enterprise operating system.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
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

## Status

Day 1 foundation: desktop shell, window management and four placeholder applications. No backend, authentication or real gameplay yet. Leaderboard data is fictional and labeled as such.
