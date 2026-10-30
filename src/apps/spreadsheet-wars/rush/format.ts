import { isFormula, parseLiteral, type CellValue } from "@/games/spreadsheet-wars/formula";
import { formatMoney } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import type { CellFormat } from "@/games/spreadsheet-wars/reconciliation-rush/types";

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatCellValue(value: CellValue, format: CellFormat): { text: string; align: "left" | "right"; isError: boolean } {
  switch (value.kind) {
    case "number":
      return { text: format === "currency" ? formatMoney(value.value) : integerFormat.format(value.value), align: "right", isError: false };
    case "text":
      return { text: value.value, align: "left", isError: false };
    case "empty":
      return { text: "", align: "left", isError: false };
    case "error":
      return { text: value.error, align: "left", isError: true };
  }
}

/** Raw content for post-round display: formulas verbatim, numbers formatted. */
export function describeContent(content: string, format: CellFormat): string {
  if (content.trim() === "") return "(empty)";
  if (isFormula(content)) return content.trim();
  return formatCellValue(parseLiteral(content), format).text;
}

/** Countdown display, rounding up so "0:00" only appears at expiry. */
export function formatCountdown(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Elapsed/remaining durations in reports, rounded down to whole seconds. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
