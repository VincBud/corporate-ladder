/**
 * The correct resolution of every opportunity, derived only from visible
 * facts and the playbook (see types.ts for the order of checks). The
 * generator is verified against this solver, never the other way round.
 */
import { DISCOUNT_STEPS, type DiscountStep, type Opportunity, type PipelineDecision, type PipelineRound, type Playbook, type ScenarioKind } from "./types";

export interface Resolution {
  decision: PipelineDecision;
  /** The rule that decided it. */
  reason: ScenarioKind;
  /** Price after discount for deals that can close (CB), else null. */
  netValue: number | null;
}

/** Gross margin (percent) at a given discount. */
export function marginAt(opportunity: Pick<Opportunity, "listPrice" | "deliveryCost">, discount: number): number {
  const price = opportunity.listPrice * (1 - discount / 100);
  return ((price - opportunity.deliveryCost) / price) * 100;
}

export const priceAt = (listPrice: number, discount: number) => Math.round(listPrice * (1 - discount / 100));

/** Smallest discount step whose price fits the budget, or null if none does. */
export function neededDiscount(listPrice: number, budget: number): DiscountStep | 0 | null {
  if (budget >= listPrice) return 0;
  return DISCOUNT_STEPS.find((step) => priceAt(listPrice, step) <= budget) ?? null;
}

/** Resolution ignoring capacity (steps 1–4). */
export function resolveAlone(o: Opportunity, playbook: Playbook): Resolution {
  if (o.budget === null) return { decision: { action: "reject" }, reason: "noBudget", netValue: null };
  if (!o.decisionMaker) return { decision: { action: "reject" }, reason: "noDecisionMaker", netValue: null };
  if (o.clauses.some((c) => playbook.restrictedClauses.includes(c))) return { decision: { action: "reject" }, reason: "restrictedClause", netValue: null };
  if (o.paymentDays > playbook.maxPaymentDays) return { decision: { action: "reject" }, reason: "paymentTerms", netValue: null };
  if (o.closeDate > playbook.quarterEnd) return { decision: { action: "defer" }, reason: "nextQuarter", netValue: null };
  const discount = neededDiscount(o.listPrice, o.budget);
  if (discount === 0) return { decision: { action: "close" }, reason: "cleanClose", netValue: o.listPrice };
  if (discount === null || discount > playbook.maxDiscount) return { decision: { action: "reject" }, reason: "discountTooDeep", netValue: null };
  if (marginAt(o, discount) < playbook.marginFloor) return { decision: { action: "reject" }, reason: "marginTrap", netValue: null };
  return { decision: { action: "discount", discount }, reason: "discountWin", netValue: priceAt(o.listPrice, discount) };
}

/** Correct resolution per opportunity id, including the capacity rule. */
export function solveRound(round: Pick<PipelineRound, "opportunities" | "playbook">): Record<string, Resolution> {
  const resolutions: Record<string, Resolution> = {};
  for (const o of round.opportunities) resolutions[o.id] = resolveAlone(o, round.playbook);
  const closable = round.opportunities
    .filter((o) => resolutions[o.id].netValue !== null)
    .sort((a, b) => resolutions[b.id].netValue! - resolutions[a.id].netValue! || a.id.localeCompare(b.id));
  for (const o of closable.slice(round.playbook.closingSlots)) {
    resolutions[o.id] = { decision: { action: "defer" }, reason: "capacity", netValue: resolutions[o.id].netValue };
  }
  return resolutions;
}
