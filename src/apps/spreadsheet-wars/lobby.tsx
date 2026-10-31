"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { ChevronRightIcon, GridIcon, LockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { GAME_MODES, type GameMode } from "@/games/spreadsheet-wars/modes";
import { cn } from "@/lib/cn";

interface SpreadsheetWarsLobbyProps {
  /** "verified": signed in, results scored by the server. "guest": local practice. */
  playMode: "verified" | "guest" | "loading";
  onPlayReconciliationRush: () => void;
  onOpenWorkspace: () => void;
  /** Move focus to the primary action on mount (when returning from another screen). */
  focusOnMount: boolean;
}

export function SpreadsheetWarsLobby({ playMode, onPlayReconciliationRush, onOpenWorkspace, focusOnMount }: SpreadsheetWarsLobbyProps) {
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const availableCount = GAME_MODES.filter((mode) => mode.status === "available").length;

  useEffect(() => {
    if (focusOnMount) playButtonRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  return (
    <div className="mx-auto max-w-5xl animate-view-in space-y-5 p-4 @xl:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-emerald-500 to-teal-700 text-white ring-1 ring-white/20 ring-inset"
          >
            <GridIcon className="size-6" />
          </span>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Spreadsheet Wars</h3>
            <p className="text-xs text-fg-muted">Competitive spreadsheet combat for ambitious professionals.</p>
          </div>
        </div>
        {playMode === "verified" ? (
          <Badge tone="success">Verified play · Cloud account</Badge>
        ) : playMode === "guest" ? (
          <Badge>Guest practice · This browser only</Badge>
        ) : (
          <Badge>Checking your badge…</Badge>
        )}
      </header>

      <p className="text-xs leading-relaxed text-fg-muted">
        {playMode === "verified"
          ? "Your rounds are scored by the server and saved to your account."
          : playMode === "guest"
            ? "Guest results are saved in this browser only. They aren't verified or ranked. Sign in from Employee Profile for verified play."
            : "Restoring your session…"}
      </p>

      <section aria-labelledby={`${id}-modes`}>
        <div className="flex items-baseline justify-between gap-3">
          <h4 id={`${id}-modes`} className="text-sm font-semibold">
            Game modes
          </h4>
          <p className="text-xs text-fg-subtle">
            {availableCount} of {GAME_MODES.length} available
          </p>
        </div>
        <ul className="mt-3 grid gap-3 @2xl:grid-cols-3">
          {GAME_MODES.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              playButtonRef={mode.id === "reconciliation-rush" ? playButtonRef : undefined}
              onPlay={mode.id === "reconciliation-rush" ? onPlayReconciliationRush : undefined}
              disabled={playMode === "loading"}
            />
          ))}
        </ul>
      </section>

      <section
        aria-labelledby={`${id}-practice`}
        className="flex flex-col gap-3 rounded-xl border border-line bg-surface-raised/40 p-4 @lg:flex-row @lg:items-center @lg:justify-between"
      >
        <div>
          <h4 id={`${id}-practice`} className="text-sm font-semibold">
            Practice sheet
          </h4>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-fg-muted">
            A read-only Q4 forecast. Get used to the grid with no clock and no consequences.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white/6 px-4 py-2 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10"
        >
          Open practice sheet
          <ChevronRightIcon className="size-4" />
        </button>
      </section>
    </div>
  );
}

interface ModeCardProps {
  mode: GameMode;
  onPlay?: () => void;
  disabled?: boolean;
  playButtonRef?: RefObject<HTMLButtonElement | null>;
}

function ModeCard({ mode, onPlay, playButtonRef, disabled = false }: ModeCardProps) {
  const playable = mode.status === "available" && onPlay;

  return (
    <li
      className={cn(
        "flex flex-col rounded-xl border p-4",
        playable ? "border-emerald-500/40 bg-emerald-500/6" : "border-line bg-surface-raised/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wider text-accent uppercase">{mode.category}</span>
        {playable ? <Badge tone="success">Playable</Badge> : <Badge>Planned</Badge>}
      </div>
      <h5 className="mt-2 text-sm font-semibold">{mode.name}</h5>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-fg-muted">{mode.description}</p>

      {playable && mode.details ? (
        <ul aria-label={`${mode.name} details`} className="mt-3 flex flex-wrap gap-1.5">
          {mode.details.map((detail) => (
            <li key={detail} className="rounded-md bg-white/6 px-2 py-0.5 text-[11px] text-fg-muted ring-1 ring-line ring-inset">
              {detail}
            </li>
          ))}
        </ul>
      ) : (
        <dl className="mt-3 flex gap-5 text-[11px]">
          <div>
            <dt className="text-fg-subtle">Format</dt>
            <dd>{mode.format}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Length</dt>
            <dd>{mode.estimatedLength}</dd>
          </div>
        </dl>
      )}

      {playable ? (
        <button
          ref={playButtonRef}
          type="button"
          onClick={onPlay}
          disabled={disabled}
          aria-label={`Play ${mode.name}`}
          className="mt-4 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          Play
          <ChevronRightIcon className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          disabled
          aria-label={`Play ${mode.name} (not available yet)`}
          className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-fg-subtle"
        >
          <LockIcon className="size-3.5" />
          Not yet playable
        </button>
      )}
    </li>
  );
}
