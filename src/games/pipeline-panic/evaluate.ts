/**
 * Compares the player's decisions with the correct resolutions and explains
 * each one. Pure: the server and the browser produce identical results.
 *
 *   correct          the right call (with the right discount)
 *   leakage          closed a winning deal with a bigger discount than needed (still within policy)
 *   badDeal          closed a deal that had to be rejected, or broke the discount limit / margin floor
 *   prioritization   closed a deal that had to wait (over capacity, or closing next quarter)
 *   missed           rejected, deferred or under-discounted a deal that should have closed
 *   misfiled         rejected a deal that should wait, or parked one that should be rejected
 *   undecided        no decision
 */
import { CLAUSES, type DiscountStep, type Opportunity, type PipelineDecision, type PipelineDecisions, type PipelineRound, type ScenarioKind } from "./types";
import { marginAt, neededDiscount, priceAt, solveRound, type Resolution } from "./solve";

export type OutcomeKind = "correct" | "leakage" | "badDeal" | "prioritization" | "missed" | "misfiled" | "undecided";

export interface OpportunityOutcome {
  id: string;
  decision: PipelineDecision | null;
  resolution: Resolution;
  kind: OutcomeKind;
  /** Why the correct resolution is correct, from visible evidence. */
  explanation: string;
  /** What happened with the player's decision. */
  verdict: string;
}

export interface PipelineEvaluation {
  outcomes: OpportunityOutcome[];
  total: number;
  correctCount: number;
  /** Every decided outcome that isn't fully correct (leakage included). */
  mistakeCount: number;
  undecidedCount: number;
}

const cb = (value: number) => `${new Intl.NumberFormat("en-US").format(value)} CB`;
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function describeDecision(decision: PipelineDecision | null): string {
  if (!decision) return "No decision";
  switch (decision.action) {
    case "close":
      return "Close at list price";
    case "discount":
      return `Close with ${decision.discount}% discount`;
    case "defer":
      return "Defer to next quarter";
    case "reject":
      return "Disqualify";
  }
}

export function explainResolution(round: Pick<PipelineRound, "playbook" | "opportunities">, o: Opportunity, resolution: Resolution, resolutions: Record<string, Resolution>): string {
  const { playbook } = round;
  const budget = o.budget ?? 0;
  const step = o.budget === null ? null : neededDiscount(o.listPrice, o.budget);
  const reasons: Record<ScenarioKind, () => string> = {
    cleanClose: () => `The budget (${cb(budget)}) covers the list price (${cb(o.listPrice)}), so close at list. Any discount gives money away.`,
    discountWin: () =>
      `The budget (${cb(budget)}) is below list (${cb(o.listPrice)}). ${step}% off (${cb(priceAt(o.listPrice, step!))}) is the smallest discount that fits, within the ${playbook.maxDiscount}% limit, at a ${Math.round(marginAt(o, step!))}% margin (floor ${playbook.marginFloor}%).`,
    discountTooDeep: () =>
      `The budget (${cb(budget)}) is below the lowest price you may offer without VP approval (${cb(priceAt(o.listPrice, playbook.maxDiscount))} at ${playbook.maxDiscount}% off), so the deal can't be won within policy.`,
    marginTrap: () =>
      `${step}% off would fit the budget, but with a delivery cost of ${cb(o.deliveryCost)} the margin drops to ${Math.round(marginAt(o, step!))}%, below the ${playbook.marginFloor}% floor.`,
    noBudget: () => "The client hasn't committed a budget, so the lead isn't qualified.",
    noDecisionMaker: () => "No decision maker is engaged (see the discovery notes), so the lead isn't qualified.",
    restrictedClause: () =>
      `The redlines ask for ${o.clauses.filter((c) => playbook.restrictedClauses.includes(c)).map((c) => CLAUSES[c].label).join(", ")}, which the playbook doesn't allow.`,
    paymentTerms: () => `Payment terms of ${o.paymentDays} days exceed the ${playbook.maxPaymentDays}-day limit.`,
    nextQuarter: () => `The expected close (${shortDate(o.closeDate)}) is after quarter end (${shortDate(playbook.quarterEnd)}): keep it for next quarter.`,
    capacity: () => {
      const winners = round.opportunities.filter((x) => resolutions[x.id].netValue !== null && resolutions[x.id].reason !== "capacity");
      return `A viable deal worth ${cb(resolution.netValue!)}, but there are only ${playbook.closingSlots} closing slots and ${winners.map((w) => `${w.account} (${cb(resolutions[w.id].netValue!)})`).join(", ")} are worth more. Defer it.`;
    },
  };
  return reasons[resolution.reason]();
}

function classify(o: Opportunity, decision: PipelineDecision | null, resolution: Resolution, round: Pick<PipelineRound, "playbook">): { kind: OutcomeKind; verdict: string } {
  const { playbook } = round;
  const wanted = resolution.decision;
  if (!decision) return { kind: "undecided", verdict: "No decision was made." };

  const closing = decision.action === "close" || decision.action === "discount";
  const shouldClose = wanted.action === "close" || wanted.action === "discount";

  if (closing && shouldClose) {
    const given = decision.action === "discount" ? decision.discount! : 0;
    const needed = wanted.action === "discount" ? wanted.discount! : 0;
    if (given === needed) return { kind: "correct", verdict: "Correct." };
    if (given < needed) return { kind: "missed", verdict: `At ${given ? `${given}% off` : "list price"} the price is above the client's budget, so the deal is lost.` };
    if (given > playbook.maxDiscount) return { kind: "badDeal", verdict: `${given}% is beyond your ${playbook.maxDiscount}% approval limit.` };
    if (marginAt(o, given) < playbook.marginFloor) return { kind: "badDeal", verdict: `At ${given}% off the margin falls below the ${playbook.marginFloor}% floor.` };
    return { kind: "leakage", verdict: `Won, but ${given}% off gave away ${cb(priceAt(o.listPrice, needed) - priceAt(o.listPrice, given))} more than needed.` };
  }
  if (closing) {
    if (wanted.action === "defer") {
      return {
        kind: "prioritization",
        verdict: resolution.reason === "capacity" ? "Closing this used a slot a more valuable deal needed." : "This deal closes next quarter; booking it now inflates the forecast.",
      };
    }
    return { kind: "badDeal", verdict: "This deal should not have been signed." };
  }
  if (shouldClose) return { kind: "missed", verdict: "A good deal was left on the table." };
  if (decision.action === wanted.action) return { kind: "correct", verdict: "Correct." };
  return wanted.action === "defer"
    ? { kind: "misfiled", verdict: "Disqualified a deal that only needed to wait." }
    : { kind: "misfiled", verdict: "Kept a deal in the pipeline that should have been disqualified." };
}

export function evaluatePipeline(round: Pick<PipelineRound, "playbook" | "opportunities">, decisions: PipelineDecisions): PipelineEvaluation {
  const resolutions = solveRound(round);
  const outcomes = round.opportunities.map((o) => {
    const decision = decisions[o.id] ?? null;
    const resolution = resolutions[o.id];
    const { kind, verdict } = classify(o, decision, resolution, round);
    return { id: o.id, decision, resolution, kind, verdict, explanation: explainResolution(round, o, resolution, resolutions) };
  });
  return {
    outcomes,
    total: outcomes.length,
    correctCount: outcomes.filter((x) => x.kind === "correct").length,
    mistakeCount: outcomes.filter((x) => x.kind !== "correct" && x.kind !== "undecided").length,
    undecidedCount: outcomes.filter((x) => x.kind === "undecided").length,
  };
}

/** Normalizes a raw decision from the UI or network; returns null if invalid. */
export function normalizeDecision(value: unknown): PipelineDecision | null {
  if (typeof value !== "object" || value === null) return null;
  const { action, discount } = value as { action?: unknown; discount?: unknown };
  if (action === "close" || action === "defer" || action === "reject") return discount === undefined ? { action } : null;
  if (action === "discount" && [5, 10, 15, 20, 25].includes(discount as number)) return { action, discount: discount as DiscountStep };
  return null;
}
