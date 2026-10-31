/** Simulation periods are UTC calendar quarters. */
import type { PeriodId } from "./types";

const PERIOD_PATTERN = /^(\d{4})-Q([1-4])$/;

export function isPeriodId(value: unknown): value is PeriodId {
  return typeof value === "string" && PERIOD_PATTERN.test(value);
}

function parts(period: PeriodId): { year: number; quarter: number } {
  const match = PERIOD_PATTERN.exec(period);
  if (!match) throw new Error(`Invalid period: ${period}`);
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

/** The quarter containing an ISO timestamp, or null if it isn't a valid date. */
export function periodOf(isoTimestamp: string): PeriodId | null {
  const time = Date.parse(isoTimestamp);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return `${date.getUTCFullYear()}-Q${(Math.floor(date.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4}`;
}

export function nextPeriod(period: PeriodId): PeriodId {
  const { year, quarter } = parts(period);
  return quarter === 4 ? `${year + 1}-Q1` : `${year}-Q${(quarter + 1) as 1 | 2 | 3 | 4}`;
}

/** Consecutive quarters starting at `first`. */
export function periodRange(first: PeriodId, count: number): PeriodId[] {
  const periods: PeriodId[] = [];
  let period = first;
  for (let i = 0; i < count; i++) {
    periods.push(period);
    period = nextPeriod(period);
  }
  return periods;
}

/** First instant of the quarter (ms since epoch, UTC). */
export function periodStart(period: PeriodId): number {
  const { year, quarter } = parts(period);
  return Date.UTC(year, (quarter - 1) * 3, 1);
}

/** "Q3 2026" */
export function periodLabel(period: PeriodId): string {
  const { year, quarter } = parts(period);
  return `Q${quarter} ${year}`;
}
