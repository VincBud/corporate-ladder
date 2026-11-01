import { describe, expect, it } from "vitest";
import { createRng } from "@/games/spreadsheet-wars/reconciliation-rush/rng";
import { evaluatePipeline, normalizeDecision } from "./evaluate";
import { findIntegrityProblems, generatePipelineRound } from "./generate";
import { NOTHING_TO_REVIEW_MESSAGE, createPipelineHint, selectHintTarget } from "./hints";
import { PIPELINE_ROUND_DURATION_MS, initialPipelineState, pipelineReducer, type PipelineState } from "./machine";
import { toPublicPipelineRound } from "./public";
import { gradePipeline } from "./report";
import { toPipelineGameResult } from "./result";
import { buildPipelineReview } from "./review";
import { PIPELINE_MAX_TIME_BONUS, PIPELINE_PENALTIES, PIPELINE_POINTS, scorePipeline } from "./scoring";
import { marginAt, neededDiscount, priceAt, resolveAlone, solveRound } from "./solve";
import type { Opportunity, PipelineDecision, PipelineDecisions, PipelineRound } from "./types";

const SEEDS = Array.from({ length: 2000 }, (_, i) => `seed-${i}`);
const perfect = (round: PipelineRound): PipelineDecisions =>
  Object.fromEntries(Object.entries(solveRound(round)).map(([id, r]) => [id, r.decision]));
const score = (round: PipelineRound, decisions: PipelineDecisions, remaining = 45_000) =>
  scorePipeline(round, evaluatePipeline(round, decisions), remaining, PIPELINE_ROUND_DURATION_MS);

describe("generation", () => {
  it("is deterministic per seed and varies between seeds", () => {
    expect(generatePipelineRound("A")).toEqual(generatePipelineRound("A"));
    expect(generatePipelineRound("A")).not.toEqual(generatePipelineRound("B"));
  });

  it("produces valid, unambiguous rounds for thousands of seeds", () => {
    for (const seed of SEEDS) expect(findIntegrityProblems(generatePipelineRound(seed)), seed).toEqual([]);
  });

  it("mixes every decision type and scenario over many rounds", () => {
    const kinds = new Map<string, number>();
    const sizes = new Set<number>();
    for (const seed of SEEDS.slice(0, 500)) {
      const round = generatePipelineRound(seed);
      sizes.add(round.opportunities.length);
      for (const r of Object.values(solveRound(round))) kinds.set(r.reason, (kinds.get(r.reason) ?? 0) + 1);
      const actions = Object.values(solveRound(round)).map((r) => r.decision.action);
      expect(new Set(actions)).toEqual(new Set(["close", "discount", "defer", "reject"]));
      expect(actions.filter((a) => a === "reject").length).toBeLessThanOrEqual(4);
    }
    expect(sizes).toEqual(new Set([8, 9, 10]));
    expect([...kinds.keys()].sort()).toEqual(
      ["capacity", "cleanClose", "discountTooDeep", "discountWin", "marginTrap", "nextQuarter", "noBudget", "noDecisionMaker", "paymentTerms", "restrictedClause"].sort(),
    );
    for (const count of kinds.values()) expect(count).toBeGreaterThan(150);
  });

  it("keeps the public view free of the seed and answer labels", () => {
    const round = generatePipelineRound("public");
    const json = JSON.stringify(toPublicPipelineRound(round));
    expect(json).not.toContain(round.seed);
    expect(json).not.toContain("scenarios");
    expect(json).not.toMatch(/cleanClose|marginTrap|capacity"/);
  });

  it("detects broken rounds", () => {
    const round = structuredClone(generatePipelineRound("broken"));
    const victim = round.opportunities.find((o) => round.scenarios[o.id].kind === "cleanClose")!;
    victim.budget = null;
    expect(findIntegrityProblems(round).join()).toMatch(/intended cleanClose, solver says noBudget/);
  });
});

describe("solver rules", () => {
  const base: Opportunity = {
    id: "o",
    account: "Test",
    industry: "Test",
    product: "Test",
    contact: { name: "A", title: "B" },
    stage: "Proposal",
    listPrice: 100_000,
    deliveryCost: 40_000,
    closeDate: "2026-12-01",
    email: { from: "", subject: "", body: [] },
    budget: 100_000,
    notes: [],
    decisionMaker: true,
    clauses: [],
    paymentDays: 30,
  };
  const playbook = generatePipelineRound("rules").playbook;
  const book = { ...playbook, maxDiscount: 15 as const, marginFloor: 30 as const, maxPaymentDays: 60 as const, restrictedClauses: ["exclusivity" as const] };

  it.each<[string, Partial<Opportunity>, PipelineDecision, string]>([
    ["budget covers list", {}, { action: "close" }, "cleanClose"],
    ["smallest fitting discount", { budget: 91_000 }, { action: "discount", discount: 10 }, "discountWin"],
    ["discount beyond the limit", { budget: 80_000 }, { action: "reject" }, "discountTooDeep"],
    ["margin below the floor", { budget: 91_000, deliveryCost: 70_000 }, { action: "reject" }, "marginTrap"],
    ["no budget", { budget: null }, { action: "reject" }, "noBudget"],
    ["no decision maker", { decisionMaker: false }, { action: "reject" }, "noDecisionMaker"],
    ["restricted clause", { clauses: ["exclusivity"] }, { action: "reject" }, "restrictedClause"],
    ["payment terms", { paymentDays: 90 }, { action: "reject" }, "paymentTerms"],
    ["next quarter", { closeDate: "2027-01-10" }, { action: "defer" }, "nextQuarter"],
  ])("%s", (_, overrides, decision, reason) => {
    const resolution = resolveAlone({ ...base, ...overrides }, book);
    expect(resolution.decision).toEqual(decision);
    expect(resolution.reason).toBe(reason);
  });

  it("checks qualification before contract, contract before timing, timing before price", () => {
    expect(resolveAlone({ ...base, budget: null, clauses: ["exclusivity"] }, book).reason).toBe("noBudget");
    expect(resolveAlone({ ...base, clauses: ["exclusivity"], closeDate: "2027-01-10" }, book).reason).toBe("restrictedClause");
    expect(resolveAlone({ ...base, closeDate: "2027-01-10", budget: 50_000 }, book).reason).toBe("nextQuarter");
  });

  it("computes prices, steps and margins", () => {
    expect(priceAt(100_000, 15)).toBe(85_000);
    expect(neededDiscount(100_000, 100_000)).toBe(0);
    expect(neededDiscount(100_000, 95_000)).toBe(5);
    expect(neededDiscount(100_000, 94_999)).toBe(10);
    expect(neededDiscount(100_000, 70_000)).toBeNull();
    expect(marginAt({ listPrice: 100_000, deliveryCost: 60_000 }, 20)).toBeCloseTo(25, 9);
  });

  it("defers the least valuable closable deals beyond capacity", () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const round = generatePipelineRound(seed);
      const solved = solveRound(round);
      const closing = Object.values(solved).filter((r) => r.decision.action === "close" || r.decision.action === "discount");
      expect(closing).toHaveLength(round.playbook.closingSlots);
      const smallest = Math.min(...closing.map((r) => r.netValue!));
      for (const r of Object.values(solved).filter((x) => x.reason === "capacity")) expect(r.netValue!).toBeLessThan(smallest);
    }
  });
});

describe("evaluation and scoring", () => {
  const round = generatePipelineRound("scoring");
  const solved = solveRound(round);
  const idOf = (reason: string) => Object.entries(solved).find(([, r]) => r.reason === reason)?.[0];

  it("scores a perfect round with the full time bonus available", () => {
    const result = score(round, perfect(round), PIPELINE_ROUND_DURATION_MS);
    expect(result.total).toBe(result.maxPossible);
    expect(result.timeBonus).toBe(PIPELINE_MAX_TIME_BONUS);
    expect(result.maxPossible).toBe(PIPELINE_MAX_TIME_BONUS + round.opportunities.reduce((s, o) => s + PIPELINE_POINTS[round.scenarios[o.id].difficulty], 0));
  });

  it("is deterministic", () => {
    const decisions = { ...perfect(round), [round.opportunities[0].id]: { action: "reject" } as PipelineDecision };
    expect(score(round, decisions)).toEqual(score(round, decisions));
  });

  it("classifies every kind of mistake", () => {
    const discountId = idOf("discountWin")!;
    const step = solved[discountId].decision.discount!;
    const cases: [string, PipelineDecision, string][] = [
      [idOf("noBudget") ?? idOf("noDecisionMaker") ?? idOf("restrictedClause") ?? idOf("paymentTerms") ?? idOf("marginTrap") ?? idOf("discountTooDeep")!, { action: "close" }, "badDeal"],
      [idOf("capacity")!, solved[idOf("capacity")!].netValue ? { action: "close" } : { action: "close" }, "prioritization"],
      [idOf("cleanClose")!, { action: "reject" }, "missed"],
      [discountId, { action: "close" }, "missed"],
    ];
    if (step + 5 <= round.playbook.maxDiscount) cases.push([discountId, { action: "discount", discount: (step + 5) as 10 }, "leakage"]);
    cases.push([discountId, { action: "discount", discount: 25 }, round.playbook.maxDiscount < 25 ? "badDeal" : "leakage"]);
    for (const [id, decision, kind] of cases) {
      const outcome = evaluatePipeline(round, { [id]: decision }).outcomes.find((o) => o.id === id)!;
      expect(outcome.kind, `${solved[id].reason} → ${JSON.stringify(decision)}`).toBe(kind);
      expect(outcome.explanation.length).toBeGreaterThan(20);
    }
  });

  it("distinguishes defer and disqualify", () => {
    const deferId = idOf("nextQuarter") ?? idOf("capacity")!;
    expect(evaluatePipeline(round, { [deferId]: { action: "reject" } }).outcomes.find((o) => o.id === deferId)!.kind).toBe("misfiled");
  });

  it("gives no time bonus to incomplete or inaccurate rounds and never goes below zero", () => {
    const decisions = { ...perfect(round) };
    delete (decisions as Record<string, PipelineDecision>)[round.opportunities[0].id];
    expect(score(round, decisions, PIPELINE_ROUND_DURATION_MS).timeBonus).toBe(0);
    const allClose = Object.fromEntries(round.opportunities.map((o) => [o.id, { action: "close" } as PipelineDecision]));
    expect(score(round, allClose).total).toBeGreaterThanOrEqual(0);
    expect(score(round, {}).total).toBe(0);
  });

  it("can't be gamed by repeating one action or clicking randomly", () => {
    const strategies: PipelineDecision[] = [
      { action: "close" },
      { action: "reject" },
      { action: "defer" },
      ...([5, 10, 15, 20, 25] as const).map((discount) => ({ action: "discount" as const, discount })),
    ];
    const rng = createRng("random-clicker");
    let randomTotal = 0;
    for (const seed of SEEDS.slice(0, 500)) {
      const r = generatePipelineRound(seed);
      for (const decision of strategies) {
        const s = score(r, Object.fromEntries(r.opportunities.map((o) => [o.id, decision])));
        expect(s.total / s.maxPossible, `${seed} ${JSON.stringify(decision)}`).toBeLessThanOrEqual(0.25);
      }
      const random = Object.fromEntries(
        r.opportunities.map((o) => [o.id, rng.pick(strategies)]),
      );
      const s = score(r, random);
      randomTotal += s.total / s.maxPossible;
    }
    expect(randomTotal / 500).toBeLessThan(0.1);
  }, 20_000); // simulates thousands of rounds; the 5 s default is too tight under full-suite load

  it("grades by accuracy and penalizes bad deals in the top grade", () => {
    expect(gradePipeline(evaluatePipeline(round, perfect(round)))).toBe("Exceeds Expectations");
    expect(gradePipeline(evaluatePipeline(round, {}))).toBe("Schedule a Meeting with HR");
    expect(PIPELINE_PENALTIES.badDeal).toBeGreaterThan(PIPELINE_PENALTIES.prioritization);
  });

  it("validates decisions from the network", () => {
    expect(normalizeDecision({ action: "close" })).toEqual({ action: "close" });
    expect(normalizeDecision({ action: "discount", discount: 15 })).toEqual({ action: "discount", discount: 15 });
    for (const bad of [null, "close", { action: "close", discount: 5 }, { action: "discount" }, { action: "discount", discount: 12 }, { action: "sell" }]) {
      expect(normalizeDecision(bad)).toBeNull();
    }
  });

  it("maps to a career record: correct decisions, total, mistakes", () => {
    const s = score(round, perfect(round));
    const review = buildPipelineReview({ round, decisions: perfect(round), remainingMs: 45_000, durationMs: PIPELINE_ROUND_DURATION_MS, hint: null });
    const record = toPipelineGameResult(
      { seed: round.seed, review: { ...review, outcome: "completed", elapsedMs: 45_000, remainingMs: 45_000, assistanceUsed: false } },
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(record).toMatchObject({ gameId: "pipeline-panic", department: "Sales", errorsFixed: round.opportunities.length, totalErrors: round.opportunities.length, incorrectCorrections: 0, accuracy: 1, score: s.total });
  });
});

describe("hints", () => {
  const round = generatePipelineRound("hints");

  it("points at the first undecided or wrong opportunity without revealing the answer", () => {
    const hint = createPipelineHint(round, {}, 10_000);
    expect(hint.opportunityId).toBe(round.opportunities[0].id);
    expect(hint.message).toContain(round.opportunities[0].account);
    expect(hint.message).not.toMatch(/\b(disqualify|reject|defer|close at|discount of)\b/i);
    expect(hint.requestedAtMs).toBe(10_000);
  });

  it("skips correctly decided opportunities and says so when all are handled", () => {
    const decisions = perfect(round);
    const firstWrong = round.opportunities[3].id;
    const almost = { ...decisions, [firstWrong]: { action: decisions[firstWrong].action === "reject" ? "defer" : "reject" } as PipelineDecision };
    expect(selectHintTarget(round, almost)).toBe(firstWrong);
    expect(createPipelineHint(round, decisions, 0)).toMatchObject({ opportunityId: null, message: NOTHING_TO_REVIEW_MESSAGE });
  });
});

describe("state machine", () => {
  const round = generatePipelineRound("machine");
  const playing = () => {
    let state: PipelineState = pipelineReducer(initialPipelineState, { type: "openBriefing", round });
    state = pipelineReducer(state, { type: "start", now: 1_000, sessionId: "s1" });
    return state as Extract<PipelineState, { phase: "playing" }>;
  };

  it("plays a local round from briefing to results", () => {
    let state: PipelineState = playing();
    for (const [id, r] of Object.entries(solveRound(round))) state = pipelineReducer(state, { type: "decide", id, decision: r.decision });
    state = pipelineReducer(state, { type: "finish", now: 31_000, outcome: "completed" });
    expect(state.phase).toBe("results");
    if (state.phase !== "results") return;
    expect(state.finished.elapsedMs).toBe(30_000);
    expect(state.finished.remainingMs).toBe(60_000);
    expect(state.finished.score.total).toBe(state.finished.score.maxPossible - Math.round(PIPELINE_MAX_TIME_BONUS / 3));
  });

  it("scores a timed-out round without time bonus", () => {
    const state = pipelineReducer(playing(), { type: "finish", now: 200_000, outcome: "timedOut" });
    expect(state.phase === "results" && state.finished).toMatchObject({ outcome: "timedOut", remainingMs: 0, elapsedMs: PIPELINE_ROUND_DURATION_MS });
  });

  it("accepts one hint per round, ignores unknown ids and can clear a decision", () => {
    let state: PipelineState = playing();
    state = pipelineReducer(state, { type: "hintReceived", sessionId: "s1", hint: { opportunityId: "opp-1", message: "a", requestedAtMs: 1 } });
    state = pipelineReducer(state, { type: "hintReceived", sessionId: "s1", hint: { opportunityId: "opp-2", message: "b", requestedAtMs: 2 } });
    expect(state.phase === "playing" && state.active.hint?.message).toBe("a");
    state = pipelineReducer(state, { type: "decide", id: "nope", decision: { action: "close" } });
    state = pipelineReducer(state, { type: "decide", id: "opp-1", decision: { action: "close" } });
    state = pipelineReducer(state, { type: "decide", id: "opp-1", decision: null });
    expect(state.phase === "playing" && state.active.decisions).toEqual({});
  });

  it("sends verified rounds to the server instead of scoring locally", () => {
    let state: PipelineState = pipelineReducer(initialPipelineState, { type: "openVerifiedBriefing" });
    state = pipelineReducer(state, {
      type: "verifiedRoundStarted",
      active: { mode: "verified", sessionId: "v1", round: toPublicPipelineRound(round), full: null, startedAt: 0, durationMs: 90_000, decisions: {}, selectedId: "opp-1", hint: null },
    });
    state = pipelineReducer(state, { type: "finish", now: 5_000, outcome: "completed" });
    expect(state.phase).toBe("submitting");
    state = pipelineReducer(state, { type: "verifiedSubmitFailed", sessionId: "v1", message: "offline" });
    expect(state.phase === "submitting" && state.error).toBe("offline");
  });
});
