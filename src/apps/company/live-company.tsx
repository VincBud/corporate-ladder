"use client";

import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompactMoney, formatNumber, formatPercent } from "@/lib/format";
import { CONTRIBUTION_RULES } from "@/simulation/contribution";
import { getMetric } from "@/simulation/departments";
import { LIVE_GAME_RULES } from "@/simulation/games";
import type { CompanySnapshot, GroupCount } from "@/simulation/source";
import { DepartmentPerformance, type DepartmentRow } from "./departments";
import { marginLabel } from "./financials";
import { Milestones } from "./milestones";
import { useLiveCompany } from "./use-live-company";

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatCompactMoney(Math.abs(value))}`;

const quietButton =
  "rounded-md bg-white/6 px-2.5 py-1 text-xs font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10 disabled:opacity-50";

export function LiveCompany({ onPlay }: { onPlay: () => void }) {
  const { state, refreshing, refresh } = useLiveCompany();

  if (state.status === "loading") {
    return (
      <div role="status" aria-label="Loading live company data" className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 @xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-lg bg-white/4 ring-1 ring-line ring-inset" />
          ))}
        </div>
        <p className="text-xs text-fg-subtle">Loading verified company data…</p>
      </div>
    );
  }

  if (state.status === "notConfigured") {
    return (
      <Notice title="Live company isn't available on this server">
        This server has no backend configured, so there is no shared company to show. The Simulation preview tab shows
        how it works with fictional data.
      </Notice>
    );
  }

  if (state.status === "unavailable" && !state.snapshot) {
    return (
      <div className="space-y-3">
        <Notice tone="warning" title="Live company data is unavailable">
          {state.message} No figures are shown rather than guessing.
        </Notice>
        <button type="button" onClick={refresh} disabled={refreshing} className={quietButton}>
          {refreshing ? "Retrying…" : "Try again"}
        </button>
      </div>
    );
  }

  const snapshot = state.snapshot!;
  const stale = state.status === "unavailable";
  return (
    <div className={cn("space-y-4 transition-opacity", refreshing && "opacity-70")} aria-busy={refreshing}>
      <LiveHeader snapshot={snapshot} refreshing={refreshing} onRefresh={refresh} />
      {stale && (
        <Notice tone="warning" title="Couldn't refresh">
          Showing the last verified snapshot from {timeFormat.format(new Date(snapshot.generatedAt))}. {state.message}
        </Notice>
      )}
      <Notice title="Live figures from verified rounds">
        All money is fictional in-game CorpBucks. The company starts each quarter from a seeded baseline; verified
        rounds by registered employees add revenue and save costs on top of it.
      </Notice>
      {snapshot.dataStatus !== "active" && <EmptyState snapshot={snapshot} onPlay={onPlay} />}
      <LiveKpis snapshot={snapshot} />
      {snapshot.dataStatus === "active" && <Impact snapshot={snapshot} />}
      <div className="grid gap-4 @4xl:grid-cols-[1fr_17rem]">
        <DepartmentPerformance
          rows={departmentRows(snapshot)}
          description="Attainment against this quarter's targets. Targets grow with registered employees; only departments a live game feeds are measured."
        />
        <div className="space-y-4">
          <Milestones milestones={snapshot.milestones} />
          <Workforce snapshot={snapshot} />
        </div>
      </div>
      <HowItWorks onPlay={onPlay} />
    </div>
  );
}

function LiveHeader({ snapshot, refreshing, onRefresh }: { snapshot: CompanySnapshot; refreshing: boolean; onRefresh: () => void }) {
  return (
    <section aria-label="Live company status" className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {snapshot.period.label} <span className="font-normal text-fg-muted">· quarter in progress</span>
          <Badge tone="success">Verified data</Badge>
          <Badge>Fictional CB</Badge>
        </h4>
        <p className="text-[11px] text-fg-subtle">
          Last verified contribution:{" "}
          {snapshot.lastContributionAt ? dateTimeFormat.format(new Date(snapshot.lastContributionAt)) : "none yet this quarter"} · Updated{" "}
          {timeFormat.format(new Date(snapshot.generatedAt))}
        </p>
      </div>
      <button type="button" onClick={onRefresh} disabled={refreshing} className={quietButton}>
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </section>
  );
}

function EmptyState({ snapshot, onPlay }: { snapshot: CompanySnapshot; onPlay: () => void }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3">
      <div>
        <p className="text-[13px] font-medium">
          {snapshot.dataStatus === "noEmployees" ? "No employees yet" : "No verified rounds yet this quarter"}
        </p>
        <p className="text-xs text-fg-muted">
          The figures below are the seeded baseline, not operating results. Sign in and play Reconciliation Rush with
          verified play to move them.
        </p>
      </div>
      <button type="button" onClick={onPlay} className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent">
        Open Spreadsheet Wars
      </button>
    </section>
  );
}

function LiveKpis({ snapshot }: { snapshot: CompanySnapshot }) {
  const { financials, employees, impact, dataStatus } = snapshot;
  const baselineOnly = dataStatus !== "active";
  const tiles: [label: string, value: string, detail: string][] = [
    ["Employees", formatNumber(employees.registered), "Registered players"],
    ["Active employees", formatNumber(employees.active), `${formatNumber(employees.contributing)} earned contribution points`],
    ["Revenue", formatCompactMoney(financials.revenue), baselineOnly ? "Seeded baseline" : `${signedMoney(impact.revenue)} from verified work`],
    ["Operating expenses", formatCompactMoney(financials.operatingExpenses), baselineOnly ? "Seeded baseline" : `${signedMoney(-impact.costSavings)} from verified work`],
    ["Net profit", formatCompactMoney(financials.netProfit), "After 25% tax on profits"],
    ["Operating margin", marginLabel(financials.profitMargin), "Operating profit ÷ revenue"],
    ["Operating efficiency", financials.operatingEfficiency.toFixed(1), `${formatPercent(financials.participationRate)} participation`],
  ];
  return (
    <section aria-label={baselineOnly ? "Company figures (seeded baseline)" : "Company figures (live)"}>
      <dl className="grid grid-cols-2 gap-2.5 @xl:grid-cols-4 @4xl:grid-cols-7">
        {tiles.map(([label, value, detail]) => (
          <div key={label} className="rounded-lg bg-white/4 px-3 py-2.5 ring-1 ring-line ring-inset">
            <dt className="text-[11px] text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">{value}</dd>
            <dd className="text-[11px] text-fg-muted">{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] text-fg-subtle">No closed quarter yet, so there are no quarter-over-quarter comparisons.</p>
    </section>
  );
}

function Impact({ snapshot }: { snapshot: CompanySnapshot }) {
  const { impact, baseline } = snapshot;
  return (
    <Panel title="What verified work changed this quarter" description="All verified rounds combined, compared with the seeded baseline. Individual contributions aren't shown.">
      <dl className="grid grid-cols-3 gap-2.5 text-[13px]">
        {[
          ["Revenue", signedMoney(impact.revenue), `Baseline ${formatCompactMoney(baseline.revenue)}`],
          ["Costs saved", signedMoney(impact.costSavings), `Baseline ${formatCompactMoney(baseline.operatingExpenses)}`],
          ["Operating profit", signedMoney(impact.operatingProfit), `Baseline ${formatCompactMoney(baseline.operatingProfit)}`],
        ].map(([label, value, detail]) => (
          <div key={label} className="rounded-lg bg-white/4 px-3 py-2 ring-1 ring-line ring-inset">
            <dt className="text-[11px] text-fg-subtle">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
            <dd className="text-[11px] text-fg-subtle tabular-nums">{detail}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function memberDetail(snapshot: CompanySnapshot, departmentId: string): string | null {
  const cell = snapshot.employees.membership?.find((g) => g.id === departmentId);
  if (!cell) return null;
  return cell.count === null ? `Fewer than ${snapshot.employees.minGroupSize} members` : `${formatNumber(cell.count)} members`;
}

function departmentRows(snapshot: CompanySnapshot): DepartmentRow[] {
  return snapshot.departments.map((d) => ({
    departmentId: d.id,
    detail: memberDetail(snapshot, d.id),
    measured: d.measured,
    attainment: d.attainment,
    status: d.status,
    contributionShare: d.contributionShare,
    revenueImpact: d.revenueImpact,
    costSavings: d.costSavings,
  }));
}

function GroupList({ title, groups, minSize, empty }: { title: string; groups: GroupCount[] | null; minSize: number; empty: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-fg-muted">{title}</h4>
      {groups === null ? (
        <p className="text-[11px] text-fg-subtle">{empty}</p>
      ) : (
        <ul className="space-y-0.5 text-[12px]">
          {groups
            .filter((g) => g.count !== 0)
            .map((g) => (
              <li key={g.id} className="flex justify-between gap-2">
                <span className="text-fg-muted">{g.name}</span>
                <span className="tabular-nums">{g.count === null ? `<${minSize}` : formatNumber(g.count)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function Workforce({ snapshot }: { snapshot: CompanySnapshot }) {
  const { employees } = snapshot;
  return (
    <Panel title="Workforce" description={`Groups smaller than ${employees.minGroupSize} aren't shown, to protect privacy.`}>
      <div className="space-y-3">
        <GroupList
          title="Employees by department"
          groups={employees.membership}
          minSize={employees.minGroupSize}
          empty={`Shown once there are at least ${employees.minGroupSize} employees.`}
        />
        <GroupList
          title="Active this quarter"
          groups={employees.activeByDepartment}
          minSize={employees.minGroupSize}
          empty={`Shown once at least ${employees.minGroupSize} employees are active.`}
        />
      </div>
    </Panel>
  );
}

function HowItWorks({ onPlay }: { onPlay: () => void }) {
  return (
    <Panel title="How your work counts" description="Verified rounds are the only input. XP and company contribution are separate.">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-fg-muted">
        <li>The server scores your verified round and records it once in the company&apos;s contribution ledger.</li>
        <li>
          Each round becomes contribution points from quality, completion and hints, capped at {CONTRIBUTION_RULES.playerHardCap} points per
          employee per quarter. Replayed cases don&apos;t count twice.
        </li>
        {LIVE_GAME_RULES.map((rule) => (
          <li key={rule.gameId}>
            {rule.title} feeds{" "}
            {Object.entries(rule.metricWeights)
              .map(([metric, weight]) => `${getMetric(metric)?.label} ${Math.round(weight * 100)}%`)
              .join(" and ")}
            , whatever business the ledger belongs to.
          </li>
        ))}
        <li>Department attainment drives revenue and cost savings on top of the seeded baseline.</li>
      </ol>
      <button type="button" onClick={onPlay} className="mt-3 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent">
        Open Spreadsheet Wars
      </button>
    </Panel>
  );
}
