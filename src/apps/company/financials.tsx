"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompactMoney, formatNumber, formatSignedPercent } from "@/lib/format";
import type { QuarterResult } from "@/simulation/economy";
import { periodLabel } from "@/simulation/periods";

// Validated against the dark surface (lightness band, CVD separation, contrast).
const REVENUE_COLOR = "#5b7ff0";
const EXPENSE_COLOR = "#ad8635";

export const marginLabel = (margin: number | null) => (margin === null ? "—" : `${(margin * 100).toFixed(1)}%`);
const shortPeriod = (q: QuarterResult) => periodLabel(q.periodId).replace(/ (\d\d)(\d\d)$/, " '$2");

interface Kpi {
  label: string;
  value: string;
  /** Change vs. the previous quarter, already formatted. */
  change: string | null;
  /** Whether the change is good news, for the arrow's color. */
  trend: "good" | "bad" | "flat" | null;
  hint: string;
}

function relativeChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function trendOf(change: number | null, higherIsBetter: boolean): Kpi["trend"] {
  if (change === null) return null;
  if (Math.abs(change) < 0.0005) return "flat";
  return change > 0 === higherIsBetter ? "good" : "bad";
}

function kpisFor(current: QuarterResult, previous: QuarterResult | undefined): Kpi[] {
  const revenue = relativeChange(current.revenue, previous?.revenue);
  const expenses = relativeChange(current.operatingExpenses, previous?.operatingExpenses);
  const net = relativeChange(current.netProfit, previous?.netProfit);
  const marginPoints = previous && current.profitMargin !== null && previous.profitMargin !== null ? current.profitMargin - previous.profitMargin : null;
  const efficiencyPoints = previous ? current.operatingEfficiency - previous.operatingEfficiency : null;
  const heads = previous ? current.employeeCount - previous.employeeCount : null;
  return [
    { label: "Revenue", value: formatCompactMoney(current.revenue), change: revenue === null ? null : formatSignedPercent(revenue), trend: trendOf(revenue, true), hint: "Base revenue plus contribution effects." },
    { label: "Operating expenses", value: formatCompactMoney(current.operatingExpenses), change: expenses === null ? null : formatSignedPercent(expenses), trend: trendOf(expenses, false), hint: "Payroll and overhead, minus efficiency savings." },
    { label: "Net profit", value: formatCompactMoney(current.netProfit), change: net === null ? null : formatSignedPercent(net), trend: trendOf(net, true), hint: "Operating profit after 25% tax on profits." },
    { label: "Operating margin", value: marginLabel(current.profitMargin), change: marginPoints === null ? null : `${formatSignedPercent(marginPoints).replace("%", "")} pts`, trend: trendOf(marginPoints, true), hint: "Operating profit ÷ revenue." },
    { label: "Operating efficiency", value: current.operatingEfficiency.toFixed(1), change: efficiencyPoints === null ? null : `${efficiencyPoints >= 0 ? "+" : "−"}${Math.abs(efficiencyPoints).toFixed(1)}`, trend: trendOf(efficiencyPoints, true), hint: "Execution 50%, participation 30%, department balance 20%." },
    { label: "Employees", value: formatNumber(current.employeeCount), change: heads === null ? null : `${heads >= 0 ? "+" : "−"}${formatNumber(Math.abs(heads))}`, trend: heads === null ? null : heads === 0 ? "flat" : "good", hint: `${formatNumber(current.activeContributors)} contributed this quarter.` },
  ];
}

export function KpiGrid({ current, previous }: { current: QuarterResult; previous: QuarterResult | undefined }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5 @xl:grid-cols-3 @4xl:grid-cols-6">
      {kpisFor(current, previous).map((kpi) => (
        <div key={kpi.label} title={kpi.hint} className="rounded-lg bg-white/4 px-3 py-2.5 ring-1 ring-line ring-inset">
          <dt className="text-[11px] text-fg-subtle">{kpi.label}</dt>
          <dd className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">{kpi.value}</dd>
          <dd className="text-[11px] text-fg-muted tabular-nums">
            {kpi.change === null ? (
              "No prior quarter"
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className={cn(kpi.trend === "good" ? "text-success" : kpi.trend === "bad" ? "text-rose-300" : "text-fg-subtle")}
                >
                  {kpi.trend === "flat" ? "■" : kpi.trend === "good" ? (kpi.label === "Operating expenses" ? "▼" : "▲") : kpi.label === "Operating expenses" ? "▲" : "▼"}
                </span>{" "}
                {kpi.change} <span className="text-fg-subtle">vs. last quarter</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Round axis maximum: 1, 2 or 5 × a power of ten above the largest value. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find((step) => step * magnitude >= value) ?? 10) * magnitude;
}

interface ChartProps {
  quarters: readonly QuarterResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Revenue vs. operating expenses per quarter. Click a quarter to open its report. */
export function QuarterlyChart({ quarters, selectedIndex, onSelect }: ChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = niceMax(Math.max(...quarters.flatMap((q) => [q.revenue, q.operatingExpenses])));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const active = hovered ?? null;

  return (
    <Panel
      title="Quarterly performance"
      description="Revenue and operating expenses. Select a quarter to open its earnings report."
    >
      <ul className="mb-3 flex flex-wrap gap-3 text-[11px] text-fg-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: REVENUE_COLOR }} />
          Revenue
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: EXPENSE_COLOR }} />
          Operating expenses
        </li>
      </ul>
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative w-11 shrink-0 text-right text-[10px] text-fg-subtle tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 translate-y-1/2" style={{ bottom: `calc(1.5rem + (100% - 1.5rem) * ${(tick / max) * 0.86})` }}>
              {tick === 0 ? "0" : formatCompactMoney(tick).replace(" CB", "")}
            </span>
          ))}
        </div>
        <div className="relative h-52 flex-1">
          {/* Plot area: bottom 1.5rem is the x-axis label row; bars use 86% of the rest. */}
          <div aria-hidden="true" className="absolute inset-x-0 top-0 bottom-6">
            {ticks.map((tick) => (
              <div
                key={tick}
                className={cn("absolute inset-x-0 border-t", tick === 0 ? "border-line-strong" : "border-line border-dashed")}
                style={{ bottom: `${(tick / max) * 86}%` }}
              />
            ))}
          </div>
          <ol className="absolute inset-0 flex">
            {quarters.map((q, i) => {
              const selected = i === selectedIndex;
              return (
                <li key={q.periodId} className="relative flex-1">
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${periodLabel(q.periodId)}: revenue ${formatCompactMoney(q.revenue)}, operating expenses ${formatCompactMoney(q.operatingExpenses)}, operating profit ${formatCompactMoney(q.operatingProfit)}`}
                    onClick={() => onSelect(i)}
                    onPointerEnter={() => setHovered(i)}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                    className={cn(
                      "group absolute inset-0 rounded-md transition-colors",
                      selected ? "bg-accent/10 ring-1 ring-accent/30 ring-inset" : "hover:bg-white/4",
                    )}
                  >
                    {/* Bars sit on the baseline; 86% of the plot height is the axis maximum. */}
                    <span className="absolute inset-x-0 top-0 bottom-6 flex items-end justify-center gap-[2px] px-[18%]">
                      {[
                        [q.revenue, REVENUE_COLOR],
                        [q.operatingExpenses, EXPENSE_COLOR],
                      ].map(([value, color]) => (
                        <span
                          key={color as string}
                          className="max-w-5 flex-1 rounded-t-[4px] transition-[height,filter] duration-500 group-hover:brightness-110"
                          style={{ height: `${((value as number) / max) * 86}%`, background: color as string }}
                        />
                      ))}
                    </span>
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-6 pt-1.5 text-center text-[10.5px] tabular-nums",
                        selected ? "font-medium text-fg" : "text-fg-subtle",
                      )}
                    >
                      {shortPeriod(q)}
                    </span>
                  </button>
                  {active === i && (
                    <div
                      role="tooltip"
                      className={cn(
                        "pointer-events-none absolute top-1 z-10 w-44 rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-[11px] shadow-xl",
                        i < quarters.length / 2 ? "left-[calc(100%+4px)]" : "right-[calc(100%+4px)]",
                      )}
                    >
                      <p className="mb-1 font-medium text-fg">{periodLabel(q.periodId)}</p>
                      {[
                        ["Revenue", formatCompactMoney(q.revenue), REVENUE_COLOR],
                        ["Expenses", formatCompactMoney(q.operatingExpenses), EXPENSE_COLOR],
                        ["Op. profit", formatCompactMoney(q.operatingProfit), null],
                      ].map(([label, value, color]) => (
                        <p key={label} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-fg-muted">
                            <span aria-hidden="true" className="h-0.5 w-2.5 rounded-full" style={{ background: color ?? "transparent" }} />
                            {label}
                          </span>
                          <span className="font-semibold text-fg tabular-nums">{value}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Panel>
  );
}

/** The table view of the chart, plus the remaining quarterly figures. */
export function HistoryTable({ quarters }: { quarters: readonly QuarterResult[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-[12.5px]">
        <caption className="sr-only">Quarterly performance history</caption>
        <thead className="bg-white/3 text-[11px] tracking-wide text-fg-subtle uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Quarter</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Revenue</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Expenses</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Op. profit</th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium @lg:table-cell">Margin</th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium @2xl:table-cell">Efficiency</th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium @2xl:table-cell">Participation</th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium @xl:table-cell">Employees</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...quarters].reverse().map((q) => (
            <tr key={q.periodId}>
              <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap">{periodLabel(q.periodId)}</th>
              <td className="px-3 py-2 text-right tabular-nums">{formatCompactMoney(q.revenue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCompactMoney(q.operatingExpenses)}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums", q.operatingProfit < 0 && "text-rose-300")}>{formatCompactMoney(q.operatingProfit)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums @lg:table-cell">{marginLabel(q.profitMargin)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums @2xl:table-cell">{q.operatingEfficiency.toFixed(1)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums @2xl:table-cell">{Math.round(q.participationRate * 100)}%</td>
              <td className="hidden px-3 py-2 text-right tabular-nums @xl:table-cell">{formatNumber(q.employeeCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
