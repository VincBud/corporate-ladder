/**
 * Seeded Pipeline Panic rounds. Same seed, same round.
 *
 * Each opportunity is built so exactly one playbook rule decides it, with
 * numeric buffers so no answer sits on a boundary (budgets are at least 1%
 * of list price away from a discount step, margins at least 2 points away
 * from the floor, capacity losers at most 85% of the smallest winner).
 * findIntegrityProblems checks every round against the independent solver.
 */
import { createRng, type Rng } from "@/games/spreadsheet-wars/reconciliation-rush/rng";
import { marginAt, neededDiscount, priceAt, solveRound } from "./solve";
import {
  CLAUSES,
  DISCOUNT_STEPS,
  type ClauseId,
  type Difficulty,
  type DiscountStep,
  type Opportunity,
  type PipelineRound,
  type Playbook,
  type ScenarioKind,
} from "./types";

export const PIPELINE_ROUND_RULES = { minOpportunities: 8, maxOpportunities: 10 } as const;

const DIFFICULTY: Record<ScenarioKind, Difficulty> = {
  cleanClose: "easy",
  noBudget: "easy",
  discountWin: "medium",
  discountTooDeep: "medium",
  noDecisionMaker: "medium",
  paymentTerms: "medium",
  nextQuarter: "medium",
  marginTrap: "hard",
  restrictedClause: "hard",
  capacity: "hard",
};

const BLOCKERS: readonly ScenarioKind[] = ["discountTooDeep", "marginTrap", "noBudget", "noDecisionMaker", "restrictedClause", "paymentTerms", "nextQuarter"];
const RISKY_CLAUSES: readonly ClauseId[] = ["unlimited-liability", "exclusivity", "most-favored-pricing", "source-code-escrow", "termination-for-convenience"];
const SAFE_CLAUSES: readonly ClauseId[] = ["on-site-support", "data-residency", "net-promoter-review"];

const ACCOUNTS: readonly [string, string][] = [
  ["Northwind Pallets", "Logistics"],
  ["Bluefin Analytics", "Data services"],
  ["Harbor & Pike Legal", "Professional services"],
  ["Quantum Spoon Co.", "Kitchenware"],
  ["Meridian Freight", "Logistics"],
  ["Copperleaf Dental", "Healthcare"],
  ["Vantage Ferns", "Horticulture"],
  ["Summit Stapler Works", "Office supplies"],
  ["Orbitol Beverages", "Food & beverage"],
  ["Lumen Yard", "Real estate"],
  ["Pinecrest Hotels", "Hospitality"],
  ["Brightline Robotics", "Manufacturing"],
  ["Cobalt Bakery Group", "Food & beverage"],
  ["Kestrel Insurance", "Insurance"],
  ["Halcyon Pet Supply", "Retail"],
  ["Granite Peak Schools", "Education"],
];
const PRODUCTS = ["SynergySuite licenses", "Alignment-as-a-Service", "Meeting Room Optimizer", "Enterprise Stapler Fleet", "Quarterly Deck Generator", "Inbox Zero Platform"];
const FIRST = ["Ava", "Ben", "Chloe", "Dev", "Elena", "Femi", "Grace", "Hugo", "Iris", "Jonas", "Kai", "Lena", "Marco", "Nia", "Omar", "Priya"];
const LAST = ["Abbott", "Brandt", "Castillo", "Duarte", "Engel", "Fischer", "Gallo", "Hart", "Ito", "Jansen", "Kowalski", "Lindqvist", "Moreau", "Novak", "Okafor", "Petrov"];
const TITLES = ["Head of Operations", "Procurement Lead", "IT Manager", "VP Finance", "Office Manager", "COO", "Project Coordinator", "Director of Facilities"];
const STAGES: Opportunity["stage"][] = ["Discovery", "Proposal", "Negotiation", "Verbal commit"];
const NOISE_NOTES = [
  "Mentioned a competitor's demo went \"fine\".",
  "Asked twice whether the product has a dark mode.",
  "Interested in onboarding workshops.",
  "Wants a reference call with a similar customer.",
  "Their current tool is a shared spreadsheet called FINAL_v7.",
  "Prefers calls before 10 AM, after coffee.",
];

const QUARTER_END = "2026-12-18";
const MAX_RETRIES = 50;

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const isoDate = (day: number) => new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
const dayOf = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(2026, 0, 1)) / 86_400_000);

function money(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(value)} CB`;
}

/** A budget strictly inside the band where `step` is the smallest fitting discount, rounded to 500 CB. */
function budgetForStep(rng: Rng, listPrice: number, step: DiscountStep): number {
  const buffer = listPrice * 0.01;
  const low = priceAt(listPrice, step) + buffer;
  const previous = step === 5 ? listPrice : priceAt(listPrice, step - 5);
  const high = previous - buffer;
  const options: number[] = [];
  for (let v = Math.ceil(low / 500) * 500; v <= high; v += 500) options.push(v);
  return rng.pick(options);
}

function makePlaybook(rng: Rng, closingSlots: number): Playbook {
  const restricted = rng.shuffle(RISKY_CLAUSES).slice(0, rng.int(2, 3));
  return {
    quarterEnd: QUARTER_END,
    maxDiscount: rng.pick([10, 15, 20] as const),
    marginFloor: rng.pick([25, 30, 35] as const),
    maxPaymentDays: rng.pick([45, 60, 90] as const),
    restrictedClauses: RISKY_CLAUSES.filter((c) => restricted.includes(c)),
    closingSlots,
  };
}

interface Draft {
  kind: ScenarioKind;
  listPrice: number;
  budget: number | null;
  deliveryCost: number;
  decisionMaker: boolean;
  clauses: ClauseId[];
  paymentDays: number;
  closeDate: string;
}

function healthyCost(rng: Rng, price: number, floor: number): number {
  return roundTo(price * (1 - rng.int(floor + 6, floor + 30) / 100), 100);
}

function allowedClauses(rng: Rng, playbook: Playbook, max: number): ClauseId[] {
  const allowed = [...SAFE_CLAUSES, ...RISKY_CLAUSES.filter((c) => !playbook.restrictedClauses.includes(c))];
  return rng.shuffle(allowed).slice(0, rng.int(0, max));
}

/** A deal that passes every check except (possibly) the one its kind is about. */
function baseDraft(rng: Rng, playbook: Playbook, kind: ScenarioKind, listPrice: number): Draft {
  return {
    kind,
    listPrice,
    budget: listPrice + 500 * rng.int(0, 12),
    deliveryCost: healthyCost(rng, listPrice, playbook.marginFloor),
    decisionMaker: true,
    clauses: allowedClauses(rng, playbook, 2),
    paymentDays: rng.pick([30, 45, 60, 90].filter((d) => d <= playbook.maxPaymentDays)),
    closeDate: isoDate(dayOf(playbook.quarterEnd) - rng.int(0, 28)),
  };
}

function closableDraft(rng: Rng, playbook: Playbook, kind: "cleanClose" | "discountWin", netTarget: number): Draft {
  if (kind === "cleanClose") return baseDraft(rng, playbook, kind, roundTo(netTarget, 1000));
  const step = rng.pick(DISCOUNT_STEPS.filter((s) => s <= playbook.maxDiscount));
  const listPrice = roundTo(netTarget / (1 - step / 100), 1000);
  const draft = baseDraft(rng, playbook, kind, listPrice);
  draft.budget = budgetForStep(rng, listPrice, step);
  draft.deliveryCost = healthyCost(rng, priceAt(listPrice, step), playbook.marginFloor);
  return draft;
}

function blockerDraft(rng: Rng, playbook: Playbook, kind: ScenarioKind): Draft {
  const attractive = kind === "restrictedClause" || kind === "paymentTerms" || kind === "nextQuarter";
  const draft = baseDraft(rng, playbook, kind, roundTo(rng.int(attractive ? 150 : 40, attractive ? 300 : 220) * 1000, 1000));
  switch (kind) {
    case "noBudget":
      draft.budget = null;
      break;
    case "noDecisionMaker":
      draft.decisionMaker = false;
      break;
    case "restrictedClause":
      draft.clauses = rng.shuffle([rng.pick(playbook.restrictedClauses), ...allowedClauses(rng, playbook, 1)]);
      break;
    case "paymentTerms":
      draft.paymentDays = rng.pick([playbook.maxPaymentDays + 30, 120].filter((d) => d > playbook.maxPaymentDays));
      break;
    case "nextQuarter":
      draft.closeDate = isoDate(dayOf(playbook.quarterEnd) + rng.int(4, 50));
      break;
    case "discountTooDeep": {
      const gap = playbook.maxDiscount + rng.int(3, 12);
      draft.budget = roundTo(draft.listPrice * (1 - gap / 100), 500);
      break;
    }
    case "marginTrap": {
      const step = rng.pick(DISCOUNT_STEPS.filter((s) => s <= playbook.maxDiscount));
      draft.budget = budgetForStep(rng, draft.listPrice, step);
      const margin = playbook.marginFloor - rng.int(3, 9);
      draft.deliveryCost = roundTo(priceAt(draft.listPrice, step) * (1 - margin / 100), 100);
      break;
    }
    default:
      throw new Error(`Not a blocker: ${kind}`);
  }
  return draft;
}

function budgetSentence(rng: Rng, budget: number | null): string {
  if (budget === null) {
    return rng.pick([
      "We haven't allocated a budget for this yet. We're still exploring options.",
      "Budget will be discussed at our planning offsite next year.",
      "Honestly, we don't have a number yet. Can you just send your best price?",
    ]);
  }
  return rng.pick([
    `We have ${money(budget)} approved for this.`,
    `Our budget is capped at ${money(budget)}, all in.`,
    `Finance signed off on up to ${money(budget)}.`,
  ]);
}

function decisionMakerNote(rng: Rng, contact: string, title: string, yes: boolean): string {
  return yes
    ? rng.pick([`Decision maker on the call: ${contact} (${title}), owns the budget and signs.`, `${contact} confirmed they sign contracts of this size personally.`])
    : rng.pick([
        `${contact} needs sign-off from their CFO, who hasn't joined any call yet.`,
        `${contact} is collecting quotes for a manager we haven't met.`,
      ]);
}

function dress(rng: Rng, draft: Draft, index: number, account: [string, string]): Opportunity {
  const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  const title = rng.pick(TITLES);
  const product = rng.pick(PRODUCTS);
  return {
    id: `opp-${index + 1}`,
    account: account[0],
    industry: account[1],
    product,
    contact: { name, title },
    stage: rng.pick(STAGES),
    listPrice: draft.listPrice,
    deliveryCost: draft.deliveryCost,
    closeDate: draft.closeDate,
    email: {
      from: `${name}, ${title}`,
      subject: rng.pick([`Re: ${product} proposal`, `Quick question on pricing`, `Next steps`, `Re: Re: Fwd: quote`]),
      body: [
        rng.pick(["Thanks for the demo last week.", "Following up on our call.", "Hope your quarter is going well."]),
        `We're keen on ${product} for the team.`,
        budgetSentence(rng, draft.budget),
        rng.pick(["Our legal team sent their redlines separately.", "Let us know about next steps.", "Looking forward to wrapping this up."]),
      ],
    },
    budget: draft.budget,
    notes: rng.shuffle([decisionMakerNote(rng, name, title, draft.decisionMaker), rng.pick(NOISE_NOTES)]),
    decisionMaker: draft.decisionMaker,
    clauses: draft.clauses,
    paymentDays: draft.paymentDays,
  };
}

function attempt(rng: Rng, seed: string): PipelineRound {
  const closingSlots = rng.int(3, 4);
  const overflow = rng.chance(0.25) ? 2 : 1;
  // At most five blockers, and never more than four disqualifications, so no single action dominates.
  const blockers = rng.int(
    Math.max(PIPELINE_ROUND_RULES.minOpportunities - closingSlots - overflow, 2),
    Math.min(5, PIPELINE_ROUND_RULES.maxOpportunities - closingSlots - overflow),
  );
  const playbook = makePlaybook(rng, closingSlots);

  // Winners: closable deals in a high value band; at least one of each closable kind.
  const winnerKinds = rng.shuffle<"cleanClose" | "discountWin">([
    "cleanClose",
    "discountWin",
    ...Array.from({ length: closingSlots - 2 }, () => rng.pick(["cleanClose", "discountWin"] as const)),
  ]);
  const winners = winnerKinds.map((kind) => closableDraft(rng, playbook, kind, rng.int(80, 240) * 1000));
  const smallestWinner = Math.min(...winners.map((d) => netOf(d)));
  // Capacity losers: closable on their own, but worth clearly less than every winner.
  const losers = Array.from({ length: overflow }, () => {
    const draft = closableDraft(rng, playbook, rng.pick(["cleanClose", "discountWin"] as const), rng.int(35, Math.floor((smallestWinner * 0.8) / 1000)) * 1000);
    return { ...draft, kind: "capacity" as const };
  });
  const rejectKinds = BLOCKERS.filter((k) => k !== "nextQuarter");
  const blockerKinds =
    blockers >= 4 ? ["nextQuarter" as const, ...rng.shuffle(rejectKinds).slice(0, blockers - 1)] : rng.shuffle(BLOCKERS).slice(0, blockers);
  const drafts = rng.shuffle([...winners, ...losers, ...blockerKinds.map((kind) => blockerDraft(rng, playbook, kind))]);
  const accounts = rng.shuffle(ACCOUNTS);

  const opportunities = drafts.map((draft, i) => dress(rng, draft, i, accounts[i]));
  return {
    seed,
    quarterLabel: "Q4 FY2026",
    playbook,
    opportunities,
    scenarios: Object.fromEntries(drafts.map((d, i) => [opportunities[i].id, { kind: d.kind, difficulty: DIFFICULTY[d.kind] }])),
  };
}

function netOf(draft: Draft): number {
  const step = neededDiscount(draft.listPrice, draft.budget ?? 0);
  return step === null ? 0 : priceAt(draft.listPrice, step);
}

/** Builds the round for a seed. Retries (deterministically) until it passes every integrity check. */
export function generatePipelineRound(seed: string): PipelineRound {
  const rng = createRng(`pipeline-panic:${seed}`);
  for (let i = 0; i < MAX_RETRIES; i++) {
    const round = attempt(rng, seed);
    if (findIntegrityProblems(round).length === 0) return round;
  }
  throw new Error(`Could not generate a valid Pipeline Panic round for seed ${seed}`);
}

/** New random seed for local play (verified rounds get theirs from the server). */
export function createPipelineSeed(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `PP-${suffix}`;
}

/** Every reason a round would be unfair or ambiguous. Empty means valid. */
export function findIntegrityProblems(round: PipelineRound): string[] {
  const problems: string[] = [];
  const { opportunities, playbook, scenarios } = round;
  const solved = solveRound(round);
  if (opportunities.length < PIPELINE_ROUND_RULES.minOpportunities || opportunities.length > PIPELINE_ROUND_RULES.maxOpportunities) {
    problems.push(`opportunity count ${opportunities.length}`);
  }
  if (new Set(opportunities.map((o) => o.id)).size !== opportunities.length) problems.push("duplicate ids");
  if (new Set(opportunities.map((o) => o.account)).size !== opportunities.length) problems.push("duplicate accounts");

  for (const o of opportunities) {
    const intended = scenarios[o.id]?.kind;
    const verdict = solved[o.id];
    if (intended !== verdict.reason) problems.push(`${o.id}: intended ${intended}, solver says ${verdict.reason}`);
    if (![o.listPrice, o.deliveryCost, o.paymentDays].every((n) => Number.isInteger(n) && n > 0)) problems.push(`${o.id}: invalid numbers`);
    if (o.clauses.some((c) => !(c in CLAUSES))) problems.push(`${o.id}: unknown clause`);
    if (o.budget !== null && o.budget < o.listPrice) {
      const step = neededDiscount(o.listPrice, o.budget);
      // The budget must sit clearly inside its discount band.
      if (step !== null && step > 0) {
        const previous = step === 5 ? o.listPrice : priceAt(o.listPrice, step - 5);
        if (o.budget - priceAt(o.listPrice, step) < o.listPrice * 0.009 || previous - o.budget < o.listPrice * 0.009) problems.push(`${o.id}: budget near a step`);
      }
    }
    if (verdict.reason === "discountWin" || verdict.reason === "cleanClose" || (verdict.reason === "capacity" && verdict.netValue !== null)) {
      const step = neededDiscount(o.listPrice, o.budget!)!;
      if (marginAt(o, step) < playbook.marginFloor + 2) problems.push(`${o.id}: margin too close to the floor`);
    }
    if (verdict.reason === "marginTrap") {
      const step = neededDiscount(o.listPrice, o.budget!)!;
      if (marginAt(o, step) > playbook.marginFloor - 2) problems.push(`${o.id}: trap margin too close to the floor`);
    }
  }

  const winners = opportunities.filter((o) => solved[o.id].netValue !== null && solved[o.id].reason !== "capacity");
  const losers = opportunities.filter((o) => solved[o.id].reason === "capacity");
  if (winners.length !== playbook.closingSlots) problems.push(`winners ${winners.length} ≠ slots ${playbook.closingSlots}`);
  if (losers.length < 1) problems.push("no capacity decision");
  if (losers.length && winners.length) {
    const smallest = Math.min(...winners.map((o) => solved[o.id].netValue!));
    const largest = Math.max(...losers.map((o) => solved[o.id].netValue!));
    if (largest > smallest * 0.85) problems.push("capacity values too close");
  }
  const actions = new Set(Object.values(solved).map((r) => r.decision.action));
  for (const action of ["close", "discount", "defer", "reject"] as const) if (!actions.has(action)) problems.push(`no ${action} decision`);
  return problems;
}
