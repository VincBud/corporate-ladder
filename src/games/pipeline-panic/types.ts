/**
 * Pipeline Panic: end-of-quarter CRM triage for the Sales department.
 *
 * Every opportunity gets one decision. The correct one follows from visible
 * evidence and the round's sales playbook, checked in this order:
 *
 *   1. Qualified?        budget confirmed (client email) and a decision maker engaged (discovery notes)
 *   2. Contract allowed? no restricted clause, payment terms within the limit (contract redlines)
 *   3. This quarter?     expected close date on or before quarter end (CRM)
 *   4. Price             budget ≥ list → close at list; otherwise the smallest discount step that
 *                        fits the budget, if within the approval limit and above the margin floor
 *   5. Capacity          only `closingSlots` deals can close; the most valuable ones win, the rest wait
 */

export const PIPELINE_ACTIONS = ["close", "discount", "defer", "reject"] as const;
export type PipelineAction = (typeof PIPELINE_ACTIONS)[number];

/** Discount steps the CRM allows (percent). */
export const DISCOUNT_STEPS = [5, 10, 15, 20, 25] as const;
export type DiscountStep = (typeof DISCOUNT_STEPS)[number];

export interface PipelineDecision {
  action: PipelineAction;
  /** Required for "discount", absent otherwise. */
  discount?: DiscountStep;
}

/** Opportunity id → decision. Missing ids are undecided. */
export type PipelineDecisions = Readonly<Record<string, PipelineDecision>>;

export const CLAUSES = {
  "unlimited-liability": { label: "Unlimited liability", text: "Vendor accepts unlimited liability for all damages, direct or indirect." },
  exclusivity: { label: "Exclusivity", text: "Vendor may not sell to the client's competitors for 3 years." },
  "most-favored-pricing": { label: "Most-favored pricing", text: "Client automatically receives the lowest price offered to any customer." },
  "source-code-escrow": { label: "Source code escrow", text: "Vendor deposits all source code with a third-party escrow agent." },
  "termination-for-convenience": { label: "Termination for convenience", text: "Client may cancel at any time with 7 days' notice and a full refund." },
  "on-site-support": { label: "On-site support", text: "Vendor provides one on-site workshop per quarter." },
  "data-residency": { label: "Data residency", text: "All data is stored in the client's region." },
  "net-promoter-review": { label: "Quarterly business review", text: "Both parties meet quarterly to review the account." },
} as const;
export type ClauseId = keyof typeof CLAUSES;

/** The round's commercial policy, shown in the briefing and the playbook panel. */
export interface Playbook {
  /** Last day deals can close this quarter (ISO date). */
  quarterEnd: string;
  /** Largest discount a rep may give without VP approval (percent). */
  maxDiscount: 10 | 15 | 20;
  /** Minimum gross margin after discount (percent). */
  marginFloor: 25 | 30 | 35;
  maxPaymentDays: 45 | 60 | 90;
  restrictedClauses: ClauseId[];
  /** How many deals the team can still close this quarter. */
  closingSlots: number;
}

export type Difficulty = "easy" | "medium" | "hard";

/** Why an opportunity has its correct resolution (generator intent = solver verdict). */
export type ScenarioKind =
  | "cleanClose"
  | "discountWin"
  | "discountTooDeep"
  | "marginTrap"
  | "noBudget"
  | "noDecisionMaker"
  | "restrictedClause"
  | "paymentTerms"
  | "nextQuarter"
  | "capacity";

export interface Opportunity {
  id: string;
  account: string;
  industry: string;
  product: string;
  contact: { name: string; title: string };
  stage: "Discovery" | "Proposal" | "Negotiation" | "Verbal commit";
  /** CB. */
  listPrice: number;
  /** CB: what delivering the deal costs us. */
  deliveryCost: number;
  /** ISO date. */
  closeDate: string;
  email: { from: string; subject: string; body: string[] };
  /** Budget stated in the email; null when the client hasn't committed one. */
  budget: number | null;
  notes: string[];
  decisionMaker: boolean;
  clauses: ClauseId[];
  paymentDays: number;
}

/** A full round (server and local play). The public view drops the hidden fields. */
export interface PipelineRound {
  seed: string;
  quarterLabel: string;
  playbook: Playbook;
  opportunities: Opportunity[];
  /** Generator intent per opportunity id (hidden from players until review). */
  scenarios: Readonly<Record<string, { kind: ScenarioKind; difficulty: Difficulty }>>;
}

export type PublicPipelineRound = Omit<PipelineRound, "seed" | "scenarios">;
