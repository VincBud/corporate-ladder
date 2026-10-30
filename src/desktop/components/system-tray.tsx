"use client";

import { BatteryIcon, WifiIcon } from "@/components/icons";
import { Avatar } from "@/components/ui/avatar";
import { getCareerSnapshot } from "@/career/progression";
import { formatNumber } from "@/lib/format";
import type { AppId } from "@/types/app";
import type { Employee } from "@/types/employee";
import { Clock } from "./clock";
import { NotificationCenter } from "./notification-center";

interface SystemTrayProps {
  employee: Employee;
  onOpenApp: (appId: AppId) => void;
}

export function SystemTray({ employee, onOpenApp }: SystemTrayProps) {
  const { progress, rank } = getCareerSnapshot(employee.xp);
  const levelSpan = progress.nextLevelXp - progress.levelStartXp;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => onOpenApp("career")}
        aria-label={`Level ${progress.level}, ${progress.xpIntoLevel} of ${levelSpan} XP. Open Corporate Career`}
        title="Corporate XP"
        className="flex h-10 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-white/8"
      >
        <span className="rounded bg-gold-soft px-1.5 py-0.5 text-[11px] font-semibold text-gold tabular-nums ring-1 ring-gold/30 ring-inset">
          Lv {progress.level}
        </span>
        <span aria-hidden="true" className="hidden w-20 flex-col gap-1 sm:flex">
          <span className="h-1 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full bg-gold" style={{ width: `${progress.ratio * 100}%` }} />
          </span>
          <span className="text-left text-[10px] leading-none text-fg-subtle tabular-nums">
            {formatNumber(progress.xpIntoLevel)} / {formatNumber(levelSpan)} XP
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpenApp("profile")}
        aria-label={`${employee.displayName}, ${rank.title}. Open Employee Profile`}
        className="flex h-10 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-white/8 md:pr-2.5"
      >
        <Avatar name={employee.displayName} size="sm" />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[12px] font-medium">{employee.displayName}</span>
          <span className="block text-[11px] text-gold/90">{rank.title}</span>
        </span>
      </button>

      <NotificationCenter />

      <div className="hidden items-center gap-2.5 px-2 text-fg-muted lg:flex">
        <span role="img" aria-label="Network: CorpNet-Guest, connected" title="CorpNet-Guest · Connected · Monitored for productivity">
          <WifiIcon className="size-4" />
        </span>
        <span role="img" aria-label="Morale: 34 percent" title="Morale: 34%. Consider a team-building exercise.">
          <BatteryIcon className="size-4.5" />
        </span>
      </div>

      <Clock />
    </div>
  );
}
