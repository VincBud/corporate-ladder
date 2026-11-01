import type { PipelineDecision, Playbook } from "@/games/pipeline-panic/types";
import { CLAUSES } from "@/games/pipeline-panic/types";

const moneyFormat = new Intl.NumberFormat("en-US");
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const cb = (value: number) => `${moneyFormat.format(value)} CB`;
export const shortDate = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00Z`));

export function decisionLabel(decision: PipelineDecision | undefined | null): string {
  if (!decision) return "Undecided";
  switch (decision.action) {
    case "close":
      return "Close at list";
    case "discount":
      return `Close −${decision.discount}%`;
    case "defer":
      return "Next quarter";
    case "reject":
      return "Disqualified";
  }
}

export function playbookLines(playbook: Playbook): [string, string][] {
  return [
    ["Quarter closes", shortDate(playbook.quarterEnd)],
    ["Closing slots left", `${playbook.closingSlots} deals`],
    ["Max discount (no VP approval)", `${playbook.maxDiscount}%`],
    ["Margin floor after discount", `${playbook.marginFloor}%`],
    ["Max payment terms", `${playbook.maxPaymentDays} days`],
    ["Restricted clauses", playbook.restrictedClauses.map((c) => CLAUSES[c].label).join(", ")],
  ];
}
