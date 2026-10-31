"use client";

import { useSyncExternalStore } from "react";
import { BriefcaseIcon, CloseIcon } from "@/components/icons";
import { BRAND } from "@/config/brand";

const KEY_PREFIX = "corporate-ladder.department-prompt-dismissed.";
const CHANGE_EVENT = "corporate-ladder:department-prompt";

function readDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(KEY_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** Whether this account dismissed the prompt in this browser. Null on the server. */
export function useDepartmentPromptDismissed(userId: string): boolean | null {
  return useSyncExternalStore(subscribe, () => readDismissed(userId), () => null);
}

function dismiss(userId: string) {
  try {
    window.localStorage.setItem(KEY_PREFIX + userId, "1");
  } catch {
    // Storage blocked: the prompt simply comes back next time.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Optional first-day invitation to pick a department. Never blocks play. */
export function DepartmentPrompt({ userId, onChoose }: { userId: string; onChoose: () => void }) {
  return (
    <div
      role="region"
      aria-label="Choose a department"
      className="absolute bottom-4 left-1/2 z-[940] flex w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 animate-pop-in items-start gap-3 rounded-xl border border-line-strong bg-desk-900/95 p-3.5 shadow-popover"
    >
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-rose-400 to-fuchsia-700 text-white">
        <BriefcaseIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">Welcome to {BRAND.company}</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Pick a department to get a job title and a career track. It doesn&apos;t change which games you can play.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              dismiss(userId);
              onChoose();
            }}
            className="rounded-md bg-accent-strong px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent"
          >
            Choose a department
          </button>
          <button type="button" onClick={() => dismiss(userId)} className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-white/6 hover:text-fg">
            Later
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => dismiss(userId)}
        aria-label="Dismiss department invitation"
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
