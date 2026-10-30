import { PRODUCTIVITY } from "../../desktop-content";
import { Widget } from "./widget";

const SPARK_WIDTH = 84;
const SPARK_HEIGHT = 24;

function sparklinePoints(values: readonly number[]): string {
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * SPARK_WIDTH;
      const y = SPARK_HEIGHT - ((value - min) / range) * (SPARK_HEIGHT - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ProductivityWidget({ className }: { className?: string }) {
  return (
    <Widget id="widget-productivity" label="Performance monitor" title="Productivity index" className={className}>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div>
          <p className="text-xl font-semibold tabular-nums">{PRODUCTIVITY.value}</p>
          <p className="text-[11px] text-fg-muted">
            {PRODUCTIVITY.change} · {PRODUCTIVITY.verdict}
          </p>
        </div>
        <svg
          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
          width={SPARK_WIDTH}
          height={SPARK_HEIGHT}
          aria-hidden="true"
          className="mb-1 shrink-0 text-accent"
        >
          <polyline
            points={sparklinePoints(PRODUCTIVITY.history)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-fg-subtle">{PRODUCTIVITY.note}</p>
    </Widget>
  );
}
