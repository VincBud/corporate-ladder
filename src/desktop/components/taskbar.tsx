"use client";

import { useRef } from "react";
import { AppIcon } from "@/apps/app-icon";
import { APPS, getApp } from "@/apps/registry";
import { OsLogo } from "@/components/brand/os-logo";
import { SearchIcon } from "@/components/icons";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/cn";
import type { AppId } from "@/types/app";
import type { Employee } from "@/types/employee";
import type { WindowState } from "../window-manager";
import { Launcher } from "./launcher";
import { SystemTray } from "./system-tray";

const LAUNCHER_ID = "launcher";

interface TaskbarProps {
  employee: Employee;
  /** Open windows in stable open order. */
  windows: readonly WindowState[];
  focusedAppId: AppId | null;
  launcherOpen: boolean;
  onLauncherOpenChange: (open: boolean) => void;
  onWindowButtonClick: (appId: AppId) => void;
  onOpenApp: (appId: AppId) => void;
}

export function Taskbar({
  employee,
  windows,
  focusedAppId,
  launcherOpen,
  onLauncherOpenChange,
  onWindowButtonClick,
  onOpenApp,
}: TaskbarProps) {
  const triggersRef = useRef<HTMLDivElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const toggleLauncher = () => onLauncherOpenChange(!launcherOpen);

  return (
    <footer className="absolute inset-x-0 bottom-0 z-[900] flex h-13 items-center gap-1 border-t border-white/8 bg-desk-900/85 px-1.5 backdrop-blur-xl select-none sm:px-2">
      <div ref={triggersRef} className="flex items-center gap-1">
        <button
          ref={startButtonRef}
          type="button"
          onClick={toggleLauncher}
          aria-label="Launcher"
          aria-expanded={launcherOpen}
          aria-haspopup="dialog"
          aria-controls={launcherOpen ? LAUNCHER_ID : undefined}
          className="flex h-10 items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-white/8 aria-expanded:bg-white/10"
        >
          <OsLogo className="size-5.5 text-accent" />
          <span className="hidden text-[13px] font-semibold tracking-tight xl:inline">{BRAND.osName}</span>
        </button>
        <button
          type="button"
          onClick={toggleLauncher}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden h-9 w-52 items-center gap-2 rounded-lg bg-white/5 px-3 text-[13px] text-fg-subtle ring-1 ring-line transition-colors ring-inset hover:bg-white/8 lg:flex"
        >
          <SearchIcon className="size-4" />
          Search
        </button>
      </div>

      <div aria-hidden="true" className="mx-1 hidden h-6 w-px bg-white/10 md:block" />

      <nav aria-label="Open windows" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {windows.map((win) => {
          const app = getApp(win.appId);
          const isFocused = win.appId === focusedAppId;
          return (
            <button
              key={win.appId}
              type="button"
              aria-pressed={isFocused}
              aria-label={`${app.title}${win.minimized ? ", minimized" : ""}`}
              title={app.title}
              onClick={() => onWindowButtonClick(win.appId)}
              className="relative flex h-10 shrink-0 items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-white/8 aria-pressed:bg-white/10"
            >
              <AppIcon app={app} size="xs" />
              <span className={cn("hidden max-w-32 truncate text-[13px] lg:inline", win.minimized && "text-fg-muted")}>
                {app.title}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-0.5 left-1/2 h-0.5 -translate-x-1/2 rounded-full transition-all",
                  isFocused ? "w-4 bg-accent" : "w-1.5 bg-fg-subtle",
                )}
              />
            </button>
          );
        })}
      </nav>

      <SystemTray employee={employee} onOpenApp={onOpenApp} />

      {launcherOpen && (
        <Launcher
          id={LAUNCHER_ID}
          apps={APPS}
          employee={employee}
          triggerRef={triggersRef}
          returnFocusRef={startButtonRef}
          onLaunch={onOpenApp}
          onClose={() => onLauncherOpenChange(false)}
        />
      )}
    </footer>
  );
}
