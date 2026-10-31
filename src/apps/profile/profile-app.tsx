"use client";

import { useId } from "react";
import { CheckIcon, LockIcon } from "@/components/icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { ACHIEVEMENTS } from "@/career/achievements";
import { getCareerSnapshot } from "@/career/progression";
import { cn } from "@/lib/cn";
import { formatIsoDate, formatNumber } from "@/lib/format";
import { useCareer } from "@/performance/use-career";
import type { AppProps } from "../types";
import { AccountPanel } from "./account-panel";

export function ProfileApp({ employee, openApp }: AppProps) {
  const { progress, rank } = getCareerSnapshot(employee.xp);
  const unlocked = new Set(employee.unlockedAchievements);
  const id = useId();
  const career = useCareer();

  const details = [
    ["Department", employee.department],
    ["Job title", employee.jobTitle ?? (employee.isGuest ? "Guest (no department)" : "Not assigned yet")],
    ["Manager", employee.manager],
    ["Location", employee.location],
    ["Join date", formatIsoDate(employee.joinedOn)],
  ] as const;

  const stats = [
    ["Level", formatNumber(progress.level)],
    ["Corporate XP", formatNumber(progress.xp)],
    ["Achievements", `${unlocked.size} / ${ACHIEVEMENTS.length}`],
    // "—" until the history has loaded, so a slow load never reads as "0 rounds".
    ["Rounds played", career.status === "ready" ? formatNumber(career.records.length) : "—"],
  ] as const;

  const settings = [
    {
      key: "reply-all",
      label: "Reply-all notifications",
      description: "Get notified every time someone replies all. Every time.",
      checked: true,
    },
    {
      key: "recruiter",
      label: "Recruiter visibility",
      description:
        "Off by default. Your profile will only ever be visible to employers if you explicitly opt in, and you can withdraw at any time.",
      checked: false,
    },
  ];

  return (
    <div className="space-y-4 p-4 @xl:p-6">
      <section className="rounded-xl border border-line bg-linear-to-br from-surface-raised to-surface p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={employee.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-semibold tracking-tight">{employee.displayName}</h3>
            <p className="font-mono text-xs text-fg-subtle">Employee #{employee.employeeNumber}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="gold">{rank.title}</Badge>
              {employee.isGuest ? <Badge>Guest · saved in this browser only</Badge> : <Badge tone="success">Cloud account</Badge>}
            </div>
          </div>
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-3 text-[13px] @lg:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] text-fg-subtle">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {!employee.isGuest && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openApp("career")}
              className="rounded-lg bg-white/6 px-3 py-1.5 text-xs font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10"
            >
              Department career &amp; transfer history
            </button>
            <button
              type="button"
              onClick={() => openApp("departments")}
              className="rounded-lg bg-white/6 px-3 py-1.5 text-xs font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10"
            >
              {employee.jobTitle ? "Departments" : "Choose a department"}
            </button>
          </div>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-raised/60 px-4 py-3">
            <dt className="text-[11px] text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <AccountPanel career={career} onOpenDepartments={() => openApp("departments")} />

      <Panel title="Achievements" description={`${unlocked.size} of ${ACHIEVEMENTS.length} unlocked`}>
        <ul className="grid gap-2 @lg:grid-cols-2">
          {ACHIEVEMENTS.map((achievement) => {
            const isUnlocked = unlocked.has(achievement.id);
            return (
              <li
                key={achievement.id}
                className={cn(
                  "flex gap-3 rounded-lg border p-3",
                  isUnlocked ? "border-gold/30 bg-gold-soft" : "border-line bg-white/2",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    isUnlocked ? "bg-gold/20 text-gold" : "bg-white/5 text-fg-subtle",
                  )}
                >
                  {isUnlocked ? <CheckIcon className="size-4" /> : <LockIcon className="size-4" />}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-[13px] font-medium", !isUnlocked && "text-fg-muted")}>
                    {achievement.title}
                    <span className="sr-only">{isUnlocked ? " (unlocked)" : " (locked)"}</span>
                  </p>
                  <p className="text-xs text-fg-subtle">{achievement.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Settings" description="Notification and visibility settings aren't available yet.">
        <div className="divide-y divide-line">
          {settings.map((setting) => (
            <div key={setting.key} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p id={`${id}-${setting.key}-label`} className="text-[13px]">
                  {setting.label}
                </p>
                <p id={`${id}-${setting.key}-desc`} className="mt-0.5 max-w-md text-xs text-fg-subtle">
                  {setting.description}
                </p>
              </div>
              <Switch
                checked={setting.checked}
                labelledBy={`${id}-${setting.key}-label`}
                describedBy={`${id}-${setting.key}-desc`}
                disabled
              />
            </div>
          ))}
          <p className="pt-3 text-xs text-fg-subtle">Sponsored placements, when they exist, will always be clearly labeled.</p>
        </div>
      </Panel>
    </div>
  );
}
