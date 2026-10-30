"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { AppIcon } from "@/apps/app-icon";
import type { AppDefinition } from "@/apps/types";
import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { COMPACT_QUERY } from "../layout";
import {
  clampWindowPosition,
  resizeRect,
  type Point,
  type Rect,
  type ResizeEdge,
  type Size,
  type WindowState,
} from "../window-manager";

type InteractionTarget = { kind: "drag" } | { kind: "resize"; edge: ResizeEdge };

type Interaction = InteractionTarget & {
  pointer: Point;
  origin: Rect;
  bounds: Size;
};

/** Invisible hit areas along each edge and corner. Corners sit above edges. */
const RESIZE_HANDLES: ReadonlyArray<{ edge: ResizeEdge; className: string }> = [
  { edge: "n", className: "inset-x-2.5 top-0 h-1.5 cursor-ns-resize" },
  { edge: "s", className: "inset-x-2.5 bottom-0 h-1.5 cursor-ns-resize" },
  { edge: "e", className: "inset-y-2.5 right-0 w-1.5 cursor-ew-resize" },
  { edge: "w", className: "inset-y-2.5 left-0 w-1.5 cursor-ew-resize" },
  { edge: "nw", className: "top-0 left-0 z-30 size-2.5 cursor-nwse-resize" },
  { edge: "ne", className: "top-0 right-0 z-30 size-2.5 cursor-nesw-resize" },
  { edge: "sw", className: "bottom-0 left-0 z-30 size-3 cursor-nesw-resize" },
  { edge: "se", className: "right-0 bottom-0 z-30 size-3 cursor-nwse-resize" },
];

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
  onResize: (rect: Rect) => void;
  /** When set, the window asks before closing (e.g. an active game round). */
  closeConfirmation?: CloseConfirmation | null;
  children: ReactNode;
}

interface CloseConfirmation {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
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
  onResize,
  closeConfirmation,
  children,
}: WindowFrameProps) {
  const interaction = useRef<Interaction | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<InteractionTarget["kind"] | null>(null);
  const titleId = `window-title-${win.appId}`;

  /** Starts a drag or resize. Disabled for maximized windows and on compact (mobile) layouts. */
  function begin(event: PointerEvent<HTMLElement>, target: InteractionTarget) {
    const workspace = workspaceRef.current;
    if (event.button !== 0 || win.maximized || !workspace) return;
    if (window.matchMedia(COMPACT_QUERY).matches) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = {
      ...target,
      pointer: { x: event.clientX, y: event.clientY },
      origin: { x: win.x, y: win.y, width: win.width, height: win.height },
      bounds: { width: workspace.clientWidth, height: workspace.clientHeight },
    };
    setActiveInteraction(target.kind);
  }

  function update(event: PointerEvent<HTMLElement>) {
    const current = interaction.current;
    if (!current) return;
    const delta = { x: event.clientX - current.pointer.x, y: event.clientY - current.pointer.y };

    if (current.kind === "drag") {
      onMove(clampWindowPosition({ x: current.origin.x + delta.x, y: current.origin.y + delta.y }, current.origin, current.bounds));
    } else {
      onResize(resizeRect(current.origin, current.edge, delta, win.minSize, current.bounds));
    }
  }

  function end(event: PointerEvent<HTMLElement>) {
    if (!interaction.current) return;
    interaction.current = null;
    setActiveInteraction(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const pointerTracking = { onPointerMove: update, onPointerUp: end, onPointerCancel: end };

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
        "absolute flex-col overflow-clip border bg-surface shadow-window animate-window-in focus:outline-none",
        win.minimized ? "hidden" : "flex",
        win.maximized ? "rounded-none border-transparent" : "rounded-xl",
        isFocused ? "border-line-strong" : "border-line",
        activeInteraction ? "select-none" : "transition-[left,top,width,height] duration-200 ease-out",
        "max-md:inset-0! max-md:h-auto! max-md:w-auto! max-md:rounded-none max-md:border-0",
      )}
    >
      <div
        onPointerDown={(event) => {
          if (!isFromButton(event.target)) begin(event, { kind: "drag" });
        }}
        {...pointerTracking}
        onDoubleClick={(event) => {
          if (!isFromButton(event.target)) onToggleMaximize();
        }}
        className={cn(
          "flex h-10 shrink-0 items-center gap-2.5 border-b border-line pr-1 pl-3 select-none md:touch-none",
          isFocused ? "bg-surface-raised" : "bg-surface",
          !win.maximized && (activeInteraction === "drag" ? "md:cursor-grabbing" : "md:cursor-grab"),
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
      {closeConfirmation && <CloseConfirmationDialog appTitle={app.title} {...closeConfirmation} />}

      {!win.maximized &&
        RESIZE_HANDLES.map(({ edge, className }) => (
          <div
            key={edge}
            aria-hidden="true"
            data-resize-edge={edge}
            onPointerDown={(event) => begin(event, { kind: "resize", edge })}
            {...pointerTracking}
            className={cn("absolute z-20 touch-none max-md:hidden", className)}
          />
        ))}
    </section>
  );
}

function CloseConfirmationDialog({ appTitle, message, onConfirm, onCancel }: CloseConfirmation & { appTitle: string }) {
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    keepButtonRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-desk-950/70 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full max-w-sm animate-pop-in rounded-xl border border-line-strong bg-surface-raised p-5 shadow-popover"
      >
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          Close {appTitle}?
        </h3>
        <p id={`${id}-message`} className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          {message}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={keepButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-white/8 px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-white/12"
          >
            Keep working
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-danger px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-danger/85"
          >
            Abandon and close
          </button>
        </div>
      </div>
    </div>
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
