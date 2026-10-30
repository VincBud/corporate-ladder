"use client";

import { useRef, useState } from "react";
import { BellIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/lib/use-dismiss";
import { SYSTEM_NOTIFICATIONS } from "../notifications";

/** Positioned against the taskbar, so render it as a direct taskbar descendant without a positioned wrapper. */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [allRead, setAllRead] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = allRead ? 0 : SYSTEM_NOTIFICATIONS.length;

  useDismiss(
    [panelRef, buttonRef],
    (reason) => {
      setOpen(false);
      if (reason === "escape") buttonRef.current?.focus();
    },
    open,
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notification-center"
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-10 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-white/8 hover:text-fg aria-expanded:bg-white/10"
      >
        <BellIcon className="size-4.5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white"
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id="notification-center"
          role="dialog"
          aria-label="Notifications"
          className="absolute right-2 bottom-[calc(100%+0.5rem)] z-[1000] w-[min(22rem,calc(100vw-1rem))] animate-pop-in overflow-hidden rounded-2xl border border-line-strong bg-desk-900/98 shadow-popover"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <button
              type="button"
              disabled={allRead}
              onClick={() => setAllRead(true)}
              className="text-xs text-accent hover:underline disabled:text-fg-subtle disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>
          <ul className="divide-y divide-line">
            {SYSTEM_NOTIFICATIONS.map((notification) => (
              <li key={notification.id} className={cn("flex gap-3 px-4 py-3", allRead && "opacity-60")}>
                <span
                  aria-hidden="true"
                  className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", allRead ? "bg-transparent" : "bg-accent")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-[11px] text-fg-subtle">
                    <span className="font-medium">{notification.source}</span>
                    <span>{notification.age}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug">{notification.message}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line bg-white/2 px-4 py-2 text-[11px] text-fg-subtle">
            Do Not Disturb is managed by your manager.
          </p>
        </div>
      )}
    </>
  );
}
