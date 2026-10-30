"use client";

import { useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { AppIcon } from "@/apps/app-icon";
import type { AppDefinition } from "@/apps/types";
import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { clampWindowPosition, type Point, type Size, type WindowState } from "../window-manager";

/** Below this width windows are full-screen and dragging is disabled. */
const COMPACT_QUERY = "(max-width: 767px)";

interface DragOrigin {
  pointer: Point;
  window: Point;
  bounds: Size;
}

interface WindowFrameProps {
  win: WindowState;
  app: AppDefinition;
  isFocused: boolean;
  zIndex: number;
  workspaceRef: RefObject<HTMLElement | null>;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onMove: (position: Point) => void;
  children: ReactNode;
}

const isFromButton = (target: EventTarget) => target instanceof Element && target.closest("button") !== null;

export function WindowFrame({
  win,
  app,
  isFocused,
  zIndex,
  workspaceRef,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onMove,
  children,
}: WindowFrameProps) {
  const dragOrigin = useRef<DragOrigin | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const titleId = `window-title-${win.appId}`;

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || win.maximized || isFromButton(event.target)) return;
    if (window.matchMedia(COMPACT_QUERY).matches) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointer: { x: event.clientX, y: event.clientY },
      window: { x: win.x, y: win.y },
      bounds: { width: workspace.clientWidth, height: workspace.clientHeight },
    };
    setIsDragging(true);
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!origin) return;
    onMove(
      clampWindowPosition(
        {
          x: origin.window.x + event.clientX - origin.pointer.x,
          y: origin.window.y + event.clientY - origin.pointer.y,
        },
        win,
        origin.bounds,
      ),
    );
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return;
    dragOrigin.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <section
      data-window-id={win.appId}
      aria-labelledby={titleId}
      tabIndex={-1}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      style={
        win.maximized
          ? { left: 0, top: 0, width: "100%", height: "100%", zIndex }
          : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex }
      }
      className={cn(
        "absolute flex-col overflow-hidden border bg-surface shadow-window animate-window-in focus:outline-none",
        win.minimized ? "hidden" : "flex",
        win.maximized ? "rounded-none border-transparent" : "rounded-xl",
        isFocused ? "border-line-strong" : "border-line",
        !isDragging && "transition-[left,top,width,height] duration-200 ease-out",
        "max-md:inset-0! max-md:h-auto! max-md:w-auto! max-md:rounded-none max-md:border-0",
      )}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          if (!isFromButton(event.target)) onToggleMaximize();
        }}
        className={cn(
          "flex h-10 shrink-0 items-center gap-2.5 border-b border-line pr-1 pl-3 select-none",
          isFocused ? "bg-surface-raised" : "bg-surface",
          !win.maximized && (isDragging ? "md:cursor-grabbing" : "md:cursor-grab"),
        )}
      >
        <AppIcon app={app} size="xs" />
        <h2 id={titleId} className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", isFocused ? "text-fg" : "text-fg-muted")}>
          {app.title}
        </h2>
        <div className="flex items-center gap-0.5">
          <WindowButton label={`Minimize ${app.title}`} onClick={onMinimize}>
            <MinimizeIcon className="size-4" />
          </WindowButton>
          <WindowButton
            label={win.maximized ? `Restore ${app.title}` : `Maximize ${app.title}`}
            onClick={onToggleMaximize}
            className="max-md:hidden"
          >
            {win.maximized ? <RestoreIcon className="size-3.5" /> : <MaximizeIcon className="size-3.5" />}
          </WindowButton>
          <WindowButton label={`Close ${app.title}`} onClick={onClose} className="hover:bg-danger hover:text-white">
            <CloseIcon className="size-4" />
          </WindowButton>
        </div>
      </div>
      <div className="@container min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

interface WindowButtonProps {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

function WindowButton({ label, onClick, className, children }: WindowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
