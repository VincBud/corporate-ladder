"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AppIcon } from "@/apps/app-icon";
import type { AppDefinition } from "@/apps/types";
import { PowerIcon, SearchIcon } from "@/components/icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getCareerSnapshot } from "@/career/progression";
import { useDismiss } from "@/lib/use-dismiss";
import type { AppId } from "@/types/app";
import type { Employee } from "@/types/employee";

const PLANNED_APPS = ["Inbox Simulator", "Meeting Bingo", "Expense Report Speedrun"];

interface LauncherProps {
  id: string;
  apps: readonly AppDefinition[];
  employee: Employee;
  /** Elements that toggle the launcher; clicks on them are not "outside". */
  triggerRef: RefObject<HTMLElement | null>;
  /** Receives focus when the launcher is dismissed with Escape. */
  returnFocusRef: RefObject<HTMLElement | null>;
  onLaunch: (appId: AppId) => void;
  onClose: () => void;
}

export function Launcher({ id, apps, employee, triggerRef, returnFocusRef, onLaunch, onClose }: LauncherProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [clockOutRequested, setClockOutRequested] = useState(false);
  const { rank } = getCareerSnapshot(employee.xp);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useDismiss([panelRef, triggerRef], (reason) => {
    onClose();
    if (reason === "escape") returnFocusRef.current?.focus();
  });

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? apps.filter((app) => `${app.title} ${app.description}`.toLowerCase().includes(normalizedQuery))
    : apps;

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label="Launcher"
      className="absolute bottom-[calc(100%+0.5rem)] left-2 z-[1000] w-[min(26rem,calc(100vw-1rem))] animate-pop-in overflow-hidden rounded-2xl border border-line-strong bg-desk-900/98 shadow-popover"
    >
      <div className="border-b border-line p-3">
        <label className="flex items-center gap-2 rounded-lg bg-white/5 px-3 ring-1 ring-line ring-inset focus-within:ring-accent/60">
          <SearchIcon className="size-4 shrink-0 text-fg-subtle" />
          <span className="sr-only">Search applications</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) onLaunch(results[0].id);
            }}
            placeholder="Search apps, people, synergies…"
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-fg-subtle focus:outline-none"
          />
        </label>
      </div>

      <div className="max-h-[min(60dvh,26rem)] overflow-y-auto p-2">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wider text-fg-subtle uppercase">Applications</p>
        {results.length > 0 ? (
          <ul>
            {results.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  onClick={() => onLaunch(app.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/6"
                >
                  <AppIcon app={app} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{app.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">{app.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-6 text-center text-[13px] text-fg-muted">
            No results for “{query.trim()}”. Have you tried scheduling a meeting about it?
          </p>
        )}

        {!normalizedQuery && (
          <>
            <p className="px-2 pt-4 pb-1.5 text-[11px] font-medium tracking-wider text-fg-subtle uppercase">Coming later</p>
            <ul>
              {PLANNED_APPS.map((title) => (
                <li key={title} className="flex items-center justify-between gap-3 px-2 py-1.5 text-[13px] text-fg-subtle">
                  {title}
                  <Badge>Planned</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-white/2 px-2 py-2">
        <button
          type="button"
          onClick={() => onLaunch("profile")}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-white/6"
        >
          <Avatar name={employee.displayName} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{employee.displayName}</span>
            <span className="block truncate text-[11px] text-fg-subtle">{rank.title}</span>
          </span>
        </button>
        <button
          type="button"
          aria-label="Clock out"
          title="Clock out"
          onClick={() => setClockOutRequested(true)}
          className="grid size-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
        >
          <PowerIcon className="size-4.5" />
        </button>
      </div>
      <p role="status" className={clockOutRequested ? "px-3 pb-2.5 text-[11px] text-warning" : "sr-only"}>
        {clockOutRequested && "Clock-out request submitted. Your manager will review it in 6–8 weeks."}
      </p>
    </div>
  );
}
