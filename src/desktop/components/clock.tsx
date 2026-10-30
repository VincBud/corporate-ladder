"use client";

import { useMinuteClock } from "../use-clock";

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

export function Clock() {
  const now = useMinuteClock();

  return (
    <div className="flex h-10 min-w-14 flex-col items-end justify-center px-2 leading-tight tabular-nums">
      {now === null ? (
        <span aria-hidden="true" className="text-[12px] text-fg-subtle">
          --:--
        </span>
      ) : (
        <time dateTime={new Date(now).toISOString()} className="text-right">
          <span className="block text-[12px] font-medium">{timeFormat.format(now)}</span>
          <span className="hidden text-[11px] text-fg-subtle sm:block">{dateFormat.format(now)}</span>
        </time>
      )}
    </div>
  );
}
