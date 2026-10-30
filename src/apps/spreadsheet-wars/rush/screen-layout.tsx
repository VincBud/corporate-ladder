import type { ReactNode } from "react";

/** Scrollable screen content with an action bar pinned to the bottom of the window. */
export function ScreenWithActions({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 animate-view-in flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-4 @xl:p-6">{children}</div>
      </div>
      <div className="border-t border-line bg-surface-raised/80 px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}
