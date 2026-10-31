import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { formatCompactMoney, formatNumber, formatPercent, formatSignedPercent } from "@/lib/format";
import type { EarningsReport } from "@/simulation/report";
import { STATUS_LABELS } from "./departments";
import { marginLabel } from "./financials";

const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatCompactMoney(Math.abs(value))}`;

interface EarningsReportViewProps {
  reports: readonly EarningsReport[];
  index: number;
  onSelect: (index: number) => void;
}

export function EarningsReportView({ reports, index, onSelect }: EarningsReportViewProps) {
  const report = reports[index];
  const demo = report.source === "demo";
  const lines: [string, string, boolean?][] = [
    ["Revenue", formatCompactMoney(report.revenue)],
    ["Operating expenses", `−${formatCompactMoney(report.operatingExpenses)}`],
    ["Operating profit", formatCompactMoney(report.operatingProfit), true],
    ["Profit margin", marginLabel(report.profitMargin)],
    ["Taxes", `−${formatCompactMoney(report.operatingProfit - report.netProfit)}`],
    ["Net profit", formatCompactMoney(report.netProfit), true],
  ];

  return (
    <article aria-labelledby="earnings-report-title" className="overflow-hidden rounded-xl border border-line bg-surface-raised/60">
      {demo && (
        <p className="bg-warning/12 px-4 py-1.5 text-center text-[11px] font-semibold tracking-wider text-warning uppercase">
          Demo report · fictional figures from the simulation preview
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[11px] tracking-wider text-fg-subtle uppercase">{report.companyName}</p>
          <h3 id="earnings-report-title" className="text-base font-semibold">
            Quarterly earnings report · {report.periodLabel}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {report.status === "finalized" ? <Badge>Finalized</Badge> : <Badge tone="gold">Draft · quarter in progress</Badge>}
            {demo && <Badge tone="warning">Demo data</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Report quarter">
          <button
            type="button"
            onClick={() => onSelect(index - 1)}
            disabled={index === 0}
            aria-label="Previous quarter"
            className="grid size-7 place-items-center rounded-md text-fg-muted ring-1 ring-line ring-inset hover:bg-white/6 disabled:opacity-40"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <select
            aria-label="Choose a quarter"
            value={index}
            onChange={(e) => onSelect(Number(e.target.value))}
            className="rounded-md border border-line bg-surface-sunken px-2 py-1 text-xs text-fg"
          >
            {reports.map((r, i) => (
              <option key={r.periodId} value={i}>
                {r.periodLabel}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onSelect(index + 1)}
            disabled={index === reports.length - 1}
            aria-label="Next quarter"
            className="grid size-7 place-items-center rounded-md text-fg-muted ring-1 ring-line ring-inset hover:bg-white/6 disabled:opacity-40"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      </header>

      <div className="grid gap-4 p-4 @2xl:grid-cols-2">
        <section aria-label="Income statement">
          <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">Income statement</h4>
          <dl className="text-[13px]">
            {lines.map(([label, value, strong]) => (
              <div key={label} className={cn("flex justify-between py-1", strong && "border-t border-line font-semibold")}>
                <dt>{label}</dt>
                <dd className={cn("tabular-nums", value.startsWith("−") && !strong && "text-fg-muted")}>{value}</dd>
              </div>
            ))}
          </dl>
          <h4 className="mt-3 mb-1.5 text-xs font-semibold text-fg-muted">Versus previous quarter</h4>
          {report.growth.revenue === null && report.growth.operatingProfit === null ? (
            <p className="text-xs text-fg-subtle">No previous quarter to compare.</p>
          ) : (
            <dl className="grid grid-cols-3 gap-2 text-[12px]">
              {[
                ["Revenue", report.growth.revenue === null ? "—" : formatSignedPercent(report.growth.revenue)],
                ["Op. profit", report.growth.operatingProfit === null ? "—" : signedMoney(report.growth.operatingProfit)],
                ["Margin", report.growth.margin === null ? "—" : `${formatSignedPercent(report.growth.margin).replace("%", "")} pts`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-white/4 px-2 py-1.5 ring-1 ring-line ring-inset">
                  <dt className="text-[10.5px] text-fg-subtle">{label}</dt>
                  <dd className="font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-[11px] text-fg-subtle">
            {formatNumber(report.employeeCount)} employees · {formatPercent(report.participationRate)} participated · efficiency{" "}
            {report.operatingEfficiency.toFixed(1)}
          </p>
        </section>

        <section aria-label="Department contributions">
          <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">Department contributions</h4>
          <table className="w-full text-[12px]">
            <thead className="sr-only">
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Share of output</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.departments.map((d) => (
                <tr key={d.departmentId}>
                  <th scope="row" className="w-full py-1 text-left font-normal">{d.name}</th>
                  <td className="py-1 text-right text-fg-muted tabular-nums">{d.attainment === null ? "—" : formatPercent(d.share)}</td>
                  <td className="py-1 pl-3 text-right text-[11px] whitespace-nowrap text-fg-subtle">{STATUS_LABELS[d.status].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.milestones.length > 0 && (
            <>
              <h4 className="mt-3 mb-1.5 text-xs font-semibold text-fg-muted">Milestones reached</h4>
              <ul className="flex flex-wrap gap-1.5">
                {report.milestones.map((m) => (
                  <li key={m.id}>
                    <Badge tone="gold">{m.title}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <blockquote className="mx-4 mb-4 rounded-lg border-l-2 border-gold/60 bg-gold-soft px-3.5 py-2.5 text-[13px] leading-relaxed">
        <p>“{report.statement.text}”</p>
        <footer className="mt-1 text-[11px] text-fg-subtle">— {report.statement.signedBy}</footer>
      </blockquote>
    </article>
  );
}
