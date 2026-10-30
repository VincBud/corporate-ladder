"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { APPS, getApp } from "@/apps/registry";
import { BRAND } from "@/config/brand";
import type { AppId } from "@/types/app";
import type { Employee } from "@/types/employee";
import {
  initialWindowManagerState,
  selectFocusedAppId,
  windowManagerReducer,
  type Size,
} from "../window-manager";
import { DesktopIcons } from "./desktop-icons";
import { OnboardingWidget } from "./onboarding-widget";
import { Taskbar } from "./taskbar";
import { Wallpaper } from "./wallpaper";
import { WindowFrame } from "./window-frame";

const FALLBACK_BOUNDS: Size = { width: 1280, height: 720 };

export function Desktop({ employee }: { employee: Employee }) {
  const [windowState, dispatch] = useReducer(windowManagerReducer, initialWindowManagerState);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  const [visitedAppIds, setVisitedAppIds] = useState<ReadonlySet<AppId>>(() => new Set());
  const workspaceRef = useRef<HTMLElement>(null);

  const focusedAppId = selectFocusedAppId(windowState);
  const windowsInOpenOrder = [...windowState.windows].sort((a, b) => a.openSeq - b.openSeq);

  // Move keyboard focus into whichever window becomes active.
  useEffect(() => {
    if (!focusedAppId) return;
    const element = workspaceRef.current?.querySelector<HTMLElement>(`[data-window-id="${focusedAppId}"]`);
    if (element && !element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
  }, [focusedAppId]);

  function openApp(appId: AppId) {
    const workspace = workspaceRef.current;
    const bounds = workspace ? { width: workspace.clientWidth, height: workspace.clientHeight } : FALLBACK_BOUNDS;
    dispatch({ type: "open", appId, size: getApp(appId).defaultSize, bounds });
    setLauncherOpen(false);
    setVisitedAppIds((previous) => (previous.has(appId) ? previous : new Set(previous).add(appId)));
  }

  function handleWindowButtonClick(appId: AppId) {
    dispatch(appId === focusedAppId ? { type: "minimize", appId } : { type: "focus", appId });
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-desk-950 text-fg">
      <h1 className="sr-only">
        {BRAND.osName} desktop — {BRAND.productName}
      </h1>
      <Wallpaper />

      <main
        ref={workspaceRef}
        aria-label="Desktop"
        className="absolute inset-x-0 top-0 bottom-13"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSelectedIcon(null);
        }}
      >
        <DesktopIcons apps={APPS} selectedId={selectedIcon} onSelect={setSelectedIcon} onOpen={openApp} />
        <OnboardingWidget visitedAppIds={visitedAppIds} onOpenApp={openApp} />

        {windowsInOpenOrder.map((win) => {
          const app = getApp(win.appId);
          const AppComponent = app.component;
          return (
            <WindowFrame
              key={win.appId}
              win={win}
              app={app}
              isFocused={win.appId === focusedAppId}
              zIndex={10 + windowState.windows.indexOf(win)}
              workspaceRef={workspaceRef}
              onFocus={() => dispatch({ type: "focus", appId: win.appId })}
              onClose={() => dispatch({ type: "close", appId: win.appId })}
              onMinimize={() => dispatch({ type: "minimize", appId: win.appId })}
              onToggleMaximize={() => dispatch({ type: "toggleMaximize", appId: win.appId })}
              onMove={(position) => dispatch({ type: "move", appId: win.appId, position })}
            >
              <AppComponent employee={employee} openApp={openApp} />
            </WindowFrame>
          );
        })}
      </main>

      <Taskbar
        employee={employee}
        windows={windowsInOpenOrder}
        focusedAppId={focusedAppId}
        launcherOpen={launcherOpen}
        onLauncherOpenChange={setLauncherOpen}
        onWindowButtonClick={handleWindowButtonClick}
        onOpenApp={openApp}
      />
    </div>
  );
}
