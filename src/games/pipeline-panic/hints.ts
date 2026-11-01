/**
 * Request Assistance: one contextual nudge per round. Points at the first
 * opportunity (in pipeline order) that is undecided or decided wrongly, and
 * says where to look, never what to decide. No score or XP penalty; company
 * contribution uses the usual assisted-round factor.
 */
import { solveRound } from "./solve";
import type { PipelineDecision, PipelineDecisions, PipelineRound, ScenarioKind } from "./types";

export interface PipelineHint {
  /** Opportunity the hint is about, or null when nothing needs attention. */
  opportunityId: string | null;
  message: string;
  /** Milliseconds into the round when the hint was given. */
  requestedAtMs: number;
}

export const NOTHING_TO_REVIEW_MESSAGE = "Every opportunity looks handled. Submit when you're ready.";

const sameDecision = (a: PipelineDecision | undefined, b: PipelineDecision) => a?.action === b.action && a?.discount === b.discount;

export function selectHintTarget(round: Pick<PipelineRound, "opportunities" | "playbook">, decisions: PipelineDecisions): string | null {
  const resolutions = solveRound(round);
  return round.opportunities.find((o) => !sameDecision(decisions[o.id], resolutions[o.id].decision))?.id ?? null;
}

const NUDGES: Record<ScenarioKind, (account: string, slots: number) => string> = {
  cleanClose: (a) => `Compare ${a}'s budget in the email with the list price.`,
  discountWin: (a) => `Compare ${a}'s budget with the list price, then check the discount limit and margin floor.`,
  discountTooDeep: (a) => `Work out how far below list ${a}'s budget is, and compare that with your approval limit.`,
  marginTrap: (a) => `Check what ${a}'s margin would be after a discount. Delivery cost is in the CRM record.`,
  noBudget: (a) => `Re-read ${a}'s email: has the client actually committed a budget?`,
  noDecisionMaker: (a) => `Read the discovery notes for ${a}: who signs the contract?`,
  restrictedClause: (a) => `Open ${a}'s contract redlines and compare each clause with the playbook.`,
  paymentTerms: (a) => `Compare ${a}'s payment terms with the playbook limit.`,
  nextQuarter: (a) => `Check ${a}'s expected close date against the quarter end.`,
  capacity: (a, slots) => `You only have ${slots} closing slots. Compare ${a}'s deal value with the other deals you can close.`,
};

export function describePipelineHint(round: Pick<PipelineRound, "opportunities" | "playbook">, opportunityId: string): string {
  const opportunity = round.opportunities.find((o) => o.id === opportunityId);
  if (!opportunity) return NOTHING_TO_REVIEW_MESSAGE;
  const reason = solveRound(round)[opportunityId].reason;
  return NUDGES[reason](opportunity.account, round.playbook.closingSlots);
}

export function createPipelineHint(round: Pick<PipelineRound, "opportunities" | "playbook">, decisions: PipelineDecisions, requestedAtMs: number): PipelineHint {
  const opportunityId = selectHintTarget(round, decisions);
  return { opportunityId, message: opportunityId ? describePipelineHint(round, opportunityId) : NOTHING_TO_REVIEW_MESSAGE, requestedAtMs };
}
