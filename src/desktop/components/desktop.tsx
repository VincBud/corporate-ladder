"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { APPS, getApp } from "@/apps/registry";
import { BRAND } from "@/config/brand";
import type { AppId } from "@/types/app";
import { getAuthStore, useAuth } from "@/auth/use-auth";
import { employeeFor } from "@/performance/player";
import { getCareerStore, useActiveCareerScope, useCareer } from "@/performance/use-career";
import type { Employee } from "@/types/employee";
import { COMPACT_QUERY } from "../layout";
import {
  initialWindowManagerState,
  selectFocusedAppId,
  windowManagerReducer,
  type Size,
} from "../window-manager";
import { DesktopIcons } from "./desktop-icons";
import { Taskbar } from "./taskbar";
import { AuthNoticeToast } from "./auth-notice-toast";
import { DepartmentPrompt, useDepartmentPromptDismissed } from "./department-prompt";
import { PromotionToast } from "./promotion-toast";
import { Wallpaper } from "./wallpaper";
import { AnnouncementWidget } from "./widgets/announcement-widget";
import { MeetingWidget } from "./widgets/meeting-widget";
import { OnboardingWidget } from "./widgets/onboarding-widget";
import { ProductivityWidget } from "./widgets/productivity-widget";
import { WindowFrame } from "./window-frame";

const FALLBACK_BOUNDS: Size = { width: 1280, height: 720 };

export function Desktop({ employee: baseEmployee }: { employee: Employee }) {
  // One player state for every app: the guest (local XP) or the signed-in
  // account (server-verified XP). Rank and level are derived from employee.xp.
  const career = useCareer();
  const auth = useAuth();
  const careerScope = useActiveCareerScope();
  const employee: Employee = employeeFor(baseEmployee, career);
  const [windowState, dispatch] = useReducer(windowManagerReducer, initialWindowManagerState);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  const [visitedAppIds, setVisitedAppIds] = useState<ReadonlySet<AppId>>(() => new Set());
  const workspaceRef = useRef<HTMLElement>(null);
  // Apps register a message when closing would lose work (e.g. an active round).
  const closeWarnings = useRef(new Map<AppId, string>());
  const [pendingClose, setPendingClose] = useState<{ appId: AppId; message: string } | null>(null);

  const focusedAppId = selectFocusedAppId(windowState);
  const windowsInOpenOrder = [...windowState.windows].sort((a, b) => a.openSeq - b.openSeq);
  // Signed-in employees without a department get an optional, dismissible invitation.
  const promptUserId = auth.status === "signedIn" && career.departmentCareer && !career.departmentCareer.current ? (auth.user?.id ?? "") : "";
  const promptDismissed = useDepartmentPromptDismissed(promptUserId);
  const showDepartmentPrompt =
    promptUserId !== "" && promptDismissed === false && !windowState.windows.some((w) => w.appId === "departments");

  // Move keyboard focus into whichever window becomes active.
  useEffect(() => {
    if (!focusedAppId) return;
    const element = workspaceRef.current?.querySelector<HTMLElement>(`[data-window-id="${focusedAppId}"]`);
    if (element && !element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
  }, [focusedAppId]);

  // Keep windows reachable when the viewport changes. Compact layouts are
  // full-screen via CSS, so stored desktop geometry is left untouched there.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(() => {
      if (window.matchMedia(COMPACT_QUERY).matches) return;
      dispatch({ type: "fitToBounds", bounds: { width: workspace.clientWidth, height: workspace.clientHeight } });
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  function openApp(appId: AppId) {
    const workspace = workspaceRef.current;
    const bounds = workspace ? { width: workspace.clientWidth, height: workspace.clientHeight } : FALLBACK_BOUNDS;
    dispatch({ type: "open", appId, sizing: getApp(appId).window, bounds });
    setLauncherOpen(false);
    setVisitedAppIds((previous) => (previous.has(appId) ? previous : new Set(previous).add(appId)));
  }

  function closeWindow(appId: AppId) {
    closeWarnings.current.delete(appId);
    setPendingClose(null);
    dispatch({ type: "close", appId });
  }

  function requestClose(appId: AppId) {
    const message = closeWarnings.current.get(appId);
    if (message) setPendingClose({ appId, message });
    else closeWindow(appId);
  }

  function setCloseWarning(appId: AppId, message: string | null) {
    if (message) closeWarnings.current.set(appId, message);
    else closeWarnings.current.delete(appId);
  }

  function handleWindowButtonClick(appId: AppId) {
    dispatch(appId === focusedAppId ? { type: "minimize", appId } : { type: "focus", appId });
  }

  return (
    // overflow-clip (not hidden): windows partly off-screen must never let focus
    // or scrollIntoView scroll the whole desktop.
    <div className="fixed inset-0 overflow-clip bg-desk-950 text-fg">
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

        {/* Widget rail (large screens). Lower-priority widgets drop out on short viewports. */}
        <div className="absolute top-4 right-4 hidden w-72 flex-col gap-3 lg:flex">
          <MeetingWidget />
          <OnboardingWidget visitedAppIds={visitedAppIds} onOpenApp={openApp} />
          <AnnouncementWidget className="[@media(max-height:719px)]:hidden" />
          <ProductivityWidget className="[@media(max-height:839px)]:hidden" />
        </div>

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
              onClose={() => requestClose(win.appId)}
              closeConfirmation={
                pendingClose?.appId === win.appId
                  ? {
                      message: pendingClose.message,
                      onConfirm: () => closeWindow(win.appId),
                      onCancel: () => setPendingClose(null),
                    }
                  : null
              }
              onMinimize={() => dispatch({ type: "minimize", appId: win.appId })}
              onToggleMaximize={() => dispatch({ type: "toggleMaximize", appId: win.appId })}
              onMove={(position) => dispatch({ type: "move", appId: win.appId, position })}
              onResize={(rect) => dispatch({ type: "resize", appId: win.appId, rect })}
            >
              <AppComponent
                employee={employee}
                openApp={openApp}
                setCloseWarning={(message) => setCloseWarning(win.appId, message)}
              />
            </WindowFrame>
          );
        })}
        {career.promotion && careerScope && (
          <PromotionToast change={career.promotion} onDismiss={() => getCareerStore(careerScope).dismissPromotion()} />
        )}
        {showDepartmentPrompt && <DepartmentPrompt userId={promptUserId} onChoose={() => openApp("departments")} />}
        {auth.notice && (
          <AuthNoticeToast notice={auth.notice} onOpenProfile={() => openApp("profile")} onDismiss={() => getAuthStore().dismissNotice()} />
        )}
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
