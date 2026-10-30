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
import type { AppProps } from "../types";

export function ProfileApp({ employee }: AppProps) {
  const { progress, rank } = getCareerSnapshot(employee.xp);
  const unlocked = new Set(employee.unlockedAchievements);
  const id = useId();

  const details = [
    ["Department", employee.department],
    ["Manager", employee.manager],
    ["Location", employee.location],
    ["Start date", formatIsoDate(employee.joinedOn)],
  ] as const;

  const stats = [
    ["Level", formatNumber(progress.level)],
    ["Corporate XP", formatNumber(progress.xp)],
    ["Achievements", `${unlocked.size} / ${ACHIEVEMENTS.length}`],
    ["Matches played", "0"],
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
              {employee.isGuest && <Badge>Guest · progress not saved</Badge>}
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
      </section>

      <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-raised/60 px-4 py-3">
            <dt className="text-[11px] text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

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

      <Panel title="Settings" description="Accounts aren't available yet, so settings can't be changed or saved.">
        <div className="divide-y divide-line">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <label htmlFor={`${id}-name`} className="text-[13px]">
              Display name
            </label>
            <input
              id={`${id}-name`}
              value={employee.displayName}
              disabled
              readOnly
              className="w-full max-w-60 rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-[13px] text-fg-muted"
            />
          </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <p className="text-xs text-fg-subtle">Sponsored placements, when they exist, will always be clearly labeled.</p>
            <button
              type="button"
              disabled
              className="rounded-lg bg-white/6 px-3 py-1.5 text-xs font-medium text-fg-subtle"
            >
              Sign in to save progress · Coming soon
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
