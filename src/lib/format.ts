import { BRAND } from "@/config/brand";

// Fixed locale and time zone keep server and client output identical.
const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatSalary(amount: number): string {
  return `${formatNumber(amount)} ${BRAND.currency}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatIsoDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "12.4M CB" */
export function formatCompactMoney(amount: number): string {
  return `${compactFormat.format(amount)} ${BRAND.currency}`;
}

/** "+4.2%" / "−1.0%" (one decimal, always signed, real minus sign). */
export function formatSignedPercent(ratio: number): string {
  const value = Math.round(ratio * 1000) / 10;
  if (value === 0) return "0.0%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

/** "Nov 30, 2026" for an ISO timestamp (UTC, so server and client agree). */
export function formatTimestampDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
