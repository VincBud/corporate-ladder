import { describe, expect, it } from "vitest";
import type { GameResultRecord } from "@/types/progression";
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_IDS, evaluateAchievements, type AchievementFacts, type AchievementId } from "./achievements";
import { departmentProgress } from "./department-tracks";

let n = 0;
function round(overrides: Partial<GameResultRecord> = {}): GameResultRecord {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    gameId: "reconciliation-rush",
    scoringVersion: 1,
    seed: `ref-${n}`,
    department: "Finance",
    difficulty: "associate",
    completedAt: `2026-11-${String(1 + (n % 27)).padStart(2, "0")}T10:00:${String(n % 60).padStart(2, "0")}.000Z`,
    completion: "submitted",
    score: 600,
    maxScore: 1050,
    grade: "Meets Expectations",
    errorsFixed: 3,
    totalErrors: 5,
    incorrectCorrections: 1,
    accuracy: 0.75,
    timeUsedMs: 60_000,
    timeRemainingMs: 30_000,
    assistanceUsed: false,
    xpAwarded: 30,
    ...overrides,
  };
}
const at = (day: number, extra = 0) => new Date(Date.UTC(2026, 10, day, 10, 0, extra)).toISOString();
const facts = (overrides: Partial<AchievementFacts> = {}): AchievementFacts => ({ results: [], memberships: [], contributions: [], dailies: [], ...overrides });
const evaluate = (f: AchievementFacts) => Object.fromEntries(evaluateAchievements(f).map((e) => [e.id, e])) as Record<AchievementId, ReturnType<typeof evaluateAchievements>[number]>;
const unlockedIds = (f: AchievementFacts) => evaluateAchievements(f).filter((e) => e.unlocked).map((e) => e.id).sort();

describe("registry", () => {
  it("has unique ids, unique display order, every category and 12–18 available achievements", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect([...ACHIEVEMENTS.map((a) => a.id)].sort()).toEqual([...ACHIEVEMENT_IDS].sort());
    expect(new Set(ACHIEVEMENTS.map((a) => a.order)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.map((a) => a.order)).toEqual([...ACHIEVEMENTS.map((a) => a.order)].sort((x, y) => x - y));
    expect(new Set(ACHIEVEMENTS.map((a) => a.category))).toEqual(new Set(ACHIEVEMENT_CATEGORIES));
    const available = ACHIEVEMENTS.filter((a) => a.status === "available");
    expect(available.length).toBeGreaterThanOrEqual(12);
    expect(available.length).toBeLessThanOrEqual(18);
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(3);
      expect(a.description.length).toBeGreaterThan(10);
      if (a.status === "future") expect(a.futureSource).toBeDefined();
    }
  });

  it("never unlocks future achievements", () => {
    const many = Array.from({ length: 60 }, () => round({ errorsFixed: 5, incorrectCorrections: 0 }));
    const result = evaluate(facts({ results: many }));
    for (const a of ACHIEVEMENTS.filter((x) => x.status === "future")) expect(result[a.id]).toMatchObject({ unlocked: false, progress: null });
  });
});

describe("evaluation", () => {
  it("unlocks nothing without verified facts (e.g. guests)", () => {
    expect(unlockedIds(facts())).toEqual([]);
  });

  it("unlocks First Assignment at the first verified round, citing it", () => {
    const first = round({ completedAt: at(2) });
    const later = round({ completedAt: at(5) });
    expect(evaluate(facts({ results: [later, first] }))["first-assignment"]).toMatchObject({
      unlocked: true,
      achievedAt: first.completedAt,
      source: { type: "game_result", id: first.id },
    });
  });

  it("distinguishes Reconciliation Rush and Pipeline Panic achievements", () => {
    const audit = round({ errorsFixed: 5, incorrectCorrections: 2, assistanceUsed: true });
    expect(unlockedIds(facts({ results: [audit] }))).toEqual(["clean-audit", "first-assignment"]);

    const deal = round({ gameId: "pipeline-panic", errorsFixed: 5, totalErrors: 9, incorrectCorrections: 2 });
    expect(unlockedIds(facts({ results: [deal] }))).toEqual(["deal-maker", "first-assignment"]);

    const perfectSales = round({ gameId: "pipeline-panic", errorsFixed: 8, totalErrors: 8, incorrectCorrections: 0, assistanceUsed: true });
    expect(unlockedIds(facts({ results: [perfectSales] }))).toEqual(["deal-maker", "first-assignment", "sales-excellence"]);
  });

  it("requires a perfect, submitted, unassisted round for No Assistance Required, and half the clock for Ahead of Schedule", () => {
    const perfect = { errorsFixed: 5, incorrectCorrections: 0 };
    expect(evaluate(facts({ results: [round({ ...perfect, assistanceUsed: true })] }))["no-assistance-required"].unlocked).toBe(false);
    expect(evaluate(facts({ results: [round({ ...perfect, completion: "timedOut" })] }))["no-assistance-required"].unlocked).toBe(false);
    expect(evaluate(facts({ results: [round({ ...perfect, timeUsedMs: 50_000, timeRemainingMs: 40_000 })] }))["ahead-of-schedule"].unlocked).toBe(false);
    const fast = evaluate(facts({ results: [round({ ...perfect, timeUsedMs: 40_000, timeRemainingMs: 50_000 })] }));
    expect(fast["no-assistance-required"].unlocked).toBe(true);
    expect(fast["ahead-of-schedule"].unlocked).toBe(true);
  });

  it("tracks Cross-Functional across both games", () => {
    const rush = round({ completedAt: at(1) });
    expect(evaluate(facts({ results: [rush] }))["cross-functional"]).toMatchObject({ unlocked: false, progress: { current: 1, target: 2 } });
    const pipeline = round({ gameId: "pipeline-panic", completedAt: at(3) });
    expect(evaluate(facts({ results: [rush, pipeline, round({ completedAt: at(4) })] }))["cross-functional"]).toMatchObject({
      unlocked: true,
      source: { id: pipeline.id },
      progress: { current: 2, target: 2 },
    });
  });

  it("counts verified rounds for Getting Started and Corporate Veteran, unlocking at the 10th and 50th", () => {
    const rounds = Array.from({ length: 50 }, (_, i) => round({ completedAt: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString() }));
    const nine = evaluate(facts({ results: rounds.slice(0, 9) }));
    expect(nine["getting-started"]).toMatchObject({ unlocked: false, progress: { current: 9, target: 10 } });
    const all = evaluate(facts({ results: rounds }));
    expect(all["getting-started"]).toMatchObject({ unlocked: true, source: { id: rounds[9].id }, progress: { current: 10, target: 10 } });
    expect(all["corporate-veteran"]).toMatchObject({ unlocked: true, source: { id: rounds[49].id }, progress: { current: 50, target: 50 } });
  });

  it("counts qualifying rounds per game, each puzzle once", () => {
    const good = (seed: string, gameId: GameResultRecord["gameId"] = "pipeline-panic") => round({ gameId, seed, errorsFixed: 8, totalErrors: 9 });
    const results = [good("a"), good("a"), good("b"), good("c"), good("d"), round({ gameId: "pipeline-panic", errorsFixed: 5, totalErrors: 9 })];
    expect(evaluate(facts({ results }))["quota-crusher"]).toMatchObject({ unlocked: false, progress: { current: 4, target: 5 } });
    expect(evaluate(facts({ results: [...results, good("e")] }))["quota-crusher"].unlocked).toBe(true);
    expect(evaluate(facts({ results: [...results, good("e")] }))["reconciliation-specialist"].progress).toEqual({ current: 0, target: 5 });
  });

  it("unlocks career achievements from memberships", () => {
    const join = { id: "m1", departmentId: "controlling", startedAt: at(1), endedAt: at(20), startReason: "initial" as const };
    const transfer = { id: "m2", departmentId: "sales", startedAt: at(20), endedAt: null, startReason: "transfer" as const };
    const result = evaluate(facts({ memberships: [join, transfer] }));
    expect(result["welcome-aboard"]).toMatchObject({ unlocked: true, achievedAt: join.startedAt, source: { type: "department_membership", id: "m1" } });
    expect(result["internal-mobility"]).toMatchObject({ unlocked: true, source: { id: "m2" } });
    expect(evaluate(facts({ memberships: [{ ...join, endedAt: null }] }))["internal-mobility"].unlocked).toBe(false);
  });

  it("follows the department career policy for promotions", () => {
    const membership = { id: "m1", departmentId: "controlling", startedAt: at(1), endedAt: null, startReason: "initial" as const };
    const qualifying = Array.from({ length: 10 }, (_, i) => round({ errorsFixed: 4, completedAt: at(2 + i) }));
    const before = round({ errorsFixed: 5, completedAt: new Date(Date.UTC(2026, 9, 1)).toISOString() }); // before joining: doesn't count
    const results = [before, ...qualifying];
    const result = evaluate(facts({ results, memberships: [membership] }));
    expect(result["climbing-the-ladder"]).toMatchObject({ unlocked: true, source: { id: qualifying[2].id } });
    expect(result["middle-management"]).toMatchObject({ unlocked: true, source: { id: qualifying[9].id } });
    // Consistent with the department career itself.
    expect(departmentProgress("controlling", [membership], results).positionIndex).toBe(2);
    const two = evaluate(facts({ results: [before, ...qualifying.slice(0, 2)], memberships: [membership] }));
    expect(two["climbing-the-ladder"]).toMatchObject({ unlocked: false, progress: { current: 2, target: 3 } });
    expect(departmentProgress("controlling", [membership], [before, ...qualifying.slice(0, 2)]).positionIndex).toBe(0);
  });

  it("doesn't promote in departments without gameplay", () => {
    const membership = { id: "m1", departmentId: "legal", startedAt: at(1), endedAt: null, startReason: "initial" as const };
    const results = Array.from({ length: 12 }, (_, i) => round({ errorsFixed: 5, completedAt: at(2 + i) }));
    expect(evaluate(facts({ results, memberships: [membership] }))["climbing-the-ladder"]).toMatchObject({ unlocked: false, progress: { current: 0, target: 3 } });
  });

  it("unlocks company achievements from contribution events, by distinct quarter", () => {
    const q3 = { sessionId: "s1", periodId: "2026-Q3", completedAt: "2026-09-10T00:00:00.000Z" };
    const q3b = { sessionId: "s2", periodId: "2026-Q3", completedAt: "2026-09-20T00:00:00.000Z" };
    const q4 = { sessionId: "s3", periodId: "2026-Q4", completedAt: "2026-10-05T00:00:00.000Z" };
    const one = evaluate(facts({ contributions: [q3b, q3] }));
    expect(one["team-player"]).toMatchObject({ unlocked: true, source: { type: "contribution_event", id: "s1" } });
    expect(one["quarterly-contributor"]).toMatchObject({ unlocked: false, progress: { current: 1, target: 2 } });
    expect(evaluate(facts({ contributions: [q3, q3b, q4] }))["quarterly-contributor"]).toMatchObject({ unlocked: true, source: { id: "s3" } });
  });

  it("is deterministic and independent of input order", () => {
    const results = Array.from({ length: 12 }, (_, i) => round({ errorsFixed: i % 6, completedAt: at(1 + i) }));
    expect(evaluateAchievements(facts({ results: [...results].reverse() }))).toEqual(evaluateAchievements(facts({ results })));
  });
});
