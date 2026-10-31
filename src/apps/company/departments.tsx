import { DEPARTMENT_TRACKS } from "@/career/department-tracks";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompactMoney, formatNumber, formatPercent } from "@/lib/format";
import { DEPARTMENTS, getDepartment, metricsOf } from "@/simulation/departments";
import { ECONOMY_RULES, type DepartmentStatus, type QuarterResult } from "@/simulation/economy";
import type { GameContributionRule } from "@/simulation/games";
import type { DepartmentId } from "@/simulation/types";

export const STATUS_LABELS: Record<DepartmentStatus, { label: string; tone: BadgeTone }> = {
  exceeding: { label: "Exceeding expectations", tone: "success" },
  onTarget: { label: "Meeting expectations", tone: "accent" },
  below: { label: "Needs alignment", tone: "gold" },
  critical: { label: "Workshop scheduled", tone: "warning" },
  notMeasured: { label: "Not measured yet", tone: "neutral" },
};

/** Attainment bar on a 0–150% scale with a tick at the 100% target. */
function AttainmentBar({ attainment, name }: { attainment: number | null; name: string }) {
  const scale = ECONOMY_RULES.maxAttainment;
  return (
    <div
      role="meter"
      aria-label={`${name} target attainment`}
      aria-valuemin={0}
      aria-valuemax={scale * 100}
      aria-valuenow={attainment === null ? undefined : Math.round(attainment * 100)}
      aria-valuetext={attainment === null ? "Not measured" : `${Math.round(attainment * 100)}% of target`}
      className="relative h-2 w-full rounded-full bg-white/8"
    >
      {attainment !== null && (
        <div className="h-full rounded-full bg-linear-to-r from-accent-strong to-accent" style={{ width: `${(attainment / scale) * 100}%` }} />
      )}
      <span aria-hidden="true" className="absolute -top-0.5 -bottom-0.5 w-px bg-fg-muted" style={{ left: `${100 / scale}%` }} />
    </div>
  );
}

export interface DepartmentRow {
  departmentId: DepartmentId;
  /** Second line under the name, e.g. headcount. */
  detail: string | null;
  measured: boolean;
  attainment: number | null;
  status: DepartmentStatus;
  contributionShare: number;
  revenueImpact: number;
  costSavings: number;
}

export function rowsFromQuarter(quarter: QuarterResult): DepartmentRow[] {
  return quarter.departments.map((d) => ({ ...d, detail: `${formatNumber(d.headcount)} employees` }));
}

interface DepartmentPerformanceProps {
  rows: readonly DepartmentRow[];
  description?: string;
}

export function DepartmentPerformance({
  rows,
  description = "Target attainment this quarter. Targets scale with department size; the tick marks 100%.",
}: DepartmentPerformanceProps) {
  return (
    <Panel title="Department performance" description={description}>
      <ul className="divide-y divide-line">
        {rows.map((d) => {
          const department = getDepartment(d.departmentId);
          const status = STATUS_LABELS[d.status];
          return (
            <li key={d.departmentId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 py-2.5 @2xl:grid-cols-[12rem_1fr_9rem_6rem]">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", department.representation.color)} />
                  <span className="truncate">{department.name}</span>
                </p>
                {d.detail && <p className="pl-4 text-[11px] text-fg-subtle">{d.detail}</p>}
              </div>
              <div className="col-span-2 row-start-2 flex items-center gap-2 @2xl:col-span-1 @2xl:row-start-auto">
                <AttainmentBar attainment={d.attainment} name={department.name} />
                <span className="w-10 shrink-0 text-right text-[12px] tabular-nums">
                  {d.attainment === null ? "—" : formatPercent(d.attainment)}
                </span>
              </div>
              <div className="col-start-2 row-start-1 justify-self-end @2xl:col-start-auto @2xl:row-start-auto">
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <p className="col-span-2 text-[11px] text-fg-subtle tabular-nums @2xl:col-span-1 @2xl:text-right">
                {d.measured ? (
                  <>
                    {formatPercent(d.contributionShare)} of output
                    <span className="@2xl:block"> · +{formatCompactMoney(d.revenueImpact + d.costSavings)}</span>
                  </>
                ) : (
                  "No supported gameplay"
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** What each department is, which games feed it and where its career path will lead. */
export function DepartmentDirectory({ rules }: { rules: readonly GameContributionRule[] }) {
  return (
    <Panel title="Department directory" description="Definitions behind the simulation. Joining a department isn't available yet.">
      <ul className="grid gap-2.5 @2xl:grid-cols-2">
        {DEPARTMENTS.map((department) => {
          const metrics = metricsOf(department.id);
          const games = rules.filter((rule) => metrics.some((m) => m.id in rule.metricWeights));
          return (
            <li key={department.id} className="rounded-lg bg-white/3 p-3 ring-1 ring-line ring-inset">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                <span aria-hidden="true" className={cn("size-2 rounded-full", department.representation.color)} />
                {department.name}
              </p>
              <p className="mt-1 text-xs text-fg-muted">{department.description}</p>
              <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-fg-subtle">Metric</dt>
                  <dd>{metrics.map((m) => m.label).join(", ")}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-fg-subtle">Fed by</dt>
                  <dd>
                    {games.length === 0
                      ? "No games yet"
                      : games.map((g) => `${g.title}${g.status === "planned" ? " (planned)" : ""}`).join(", ")}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-fg-subtle">Career</dt>
                  <dd>
                    {DEPARTMENT_TRACKS[department.id][0].title} → {DEPARTMENT_TRACKS[department.id].at(-1)!.title}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
