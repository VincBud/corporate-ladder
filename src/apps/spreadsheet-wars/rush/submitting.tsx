"use client";

import { ScreenWithActions } from "./screen-layout";

interface SubmittingProps {
  error: string | null;
  onRetry: () => void;
  onLobby: () => void;
}

/** Waiting for the server to verify a round. */
export function Submitting({ error, onRetry, onLobby }: SubmittingProps) {
  return (
    <ScreenWithActions
      actions={
        error ? (
          <>
            <button
              type="button"
              onClick={onLobby}
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg"
            >
              Back to lobby
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Try again
            </button>
          </>
        ) : null
      }
    >
      <div role="status" className="space-y-3 py-10 text-center">
        <p className="text-[11px] font-medium tracking-[0.18em] text-fg-subtle uppercase">Task Performance Report</p>
        {error ? (
          <>
            <h3 className="text-lg font-semibold">Couldn&apos;t reach Finance Operations</h3>
            <p className="mx-auto max-w-md text-[13px] leading-relaxed text-fg-muted">{error}</p>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-fg-subtle">
              Retrying is safe: a round is scored only once. Cells that reach the server more than 3 seconds after the
              time limit can&apos;t be counted, because they could have been changed after time ran out.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Verifying your reconciliation…</h3>
            <p className="text-[13px] text-fg-muted">The server is rebuilding the case and checking every cell.</p>
          </>
        )}
      </div>
    </ScreenWithActions>
  );
}
