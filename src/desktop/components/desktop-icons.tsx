"use client";

import { useRef } from "react";
import { AppIcon } from "@/apps/app-icon";
import type { AppDefinition } from "@/apps/types";
import { cn } from "@/lib/cn";
import type { AppId } from "@/types/app";

interface DesktopIconsProps {
  apps: readonly AppDefinition[];
  selectedId: AppId | null;
  onSelect: (appId: AppId) => void;
  onOpen: (appId: AppId) => void;
}

export function DesktopIcons({ apps, selectedId, onSelect, onOpen }: DesktopIconsProps) {
  return (
    <div
      role="group"
      aria-label="Desktop shortcuts"
      className="absolute inset-x-0 top-0 grid grid-cols-4 gap-1 p-3 md:right-auto md:grid-cols-1 md:p-4"
    >
      {apps.map((app) => (
        <DesktopIcon
          key={app.id}
          app={app}
          selected={selectedId === app.id}
          onSelect={() => onSelect(app.id)}
          onOpen={() => onOpen(app.id)}
        />
      ))}
    </div>
  );
}

interface DesktopIconProps {
  app: AppDefinition;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/** Mouse: click selects, double-click opens. Touch and keyboard: single activation opens. */
function DesktopIcon({ app, selected, onSelect, onOpen }: DesktopIconProps) {
  const pointerType = useRef<string>("mouse");

  return (
    <button
      type="button"
      title={`${app.description} Double-click to open.`}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
      }}
      onClick={(event) => {
        // detail === 0 means the click came from the keyboard.
        if (event.detail === 0 || pointerType.current === "touch") onOpen();
        else onSelect();
      }}
      onDoubleClick={onOpen}
      className={cn(
        "group flex w-full flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors select-none md:w-24",
        selected ? "bg-accent/15 ring-1 ring-accent/40 ring-inset" : "hover:bg-white/6",
      )}
    >
      <AppIcon app={app} size="lg" className="transition-transform group-active:scale-95" />
      <span className="line-clamp-2 text-xs font-medium text-fg [text-shadow:0_1px_3px_rgb(0_0_0/0.7)]">
        {app.title}
      </span>
    </button>
  );
}
