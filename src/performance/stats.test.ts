import { describe, expect, it } from "vitest";
import type { GameResultRecord } from "@/types/progression";
import { comparisonKey, personalBest, recentResults, scoreShare, summarizePerformance } from "./stats";
import { resultInput } from "./test-fixtures";

let n = 0;
const rec = (overrides: Partial<GameResultRecord> = {}): GameResultRecord => ({ ...resultInput(), id: `r${n++}`, xpAwarded: 10, ...overrides });
const KEY = comparisonKey(resultInput());

describe("performance selectors", () => {
  it("handles an empty history without NaN", () => {
    const summary = summarizePerformance([]);
    expect(summary).toMatchObject({
      gamesPlayed: 0,
      totalXp: 0,
      totalErrorsFixed: 0,
      averageScore: null,
      averageAccuracy: null,
      averageScoreShare: null,
    });
    expect(summary.assisted.averageAccuracy).toBeNull();
    expect(personalBest([], KEY)).toBeNull();
    expect(recentResults([])).toEqual([]);
  });

  it("aggregates totals and averages", () => {
    const records = [
      rec({ score: 800, maxScore: 1000, accuracy: 1, errorsFixed: 5, xpAwarded: 40 }),
      rec({ score: 400, maxScore: 800, accuracy: 0.5, errorsFixed: 2, xpAwarded: 20 }),
      rec({ score: 0, maxScore: 900, accuracy: null, errorsFixed: 0, xpAwarded: 0 }),
    ];
    const summary = summarizePerformance(records);
    expect(summary.gamesPlayed).toBe(3);
    expect(summary.totalXp).toBe(60);
    expect(summary.totalErrorsFixed).toBe(7);
    expect(summary.totalErrors).toBe(15);
    expect(summary.averageScore).toBe(400);
    expect(summary.averageAccuracy).toBe(0.75); // the round without attempts is excluded
    expect(summary.averageScoreShare).toBeCloseTo((0.8 + 0.5 + 0) / 3);
  });

  it("splits assisted and unassisted performance", () => {
    const summary = summarizePerformance([
      rec({ assistanceUsed: true, score: 500, maxScore: 1000, accuracy: 0.5 }),
      rec({ assistanceUsed: false, score: 900, maxScore: 1000, accuracy: 1 }),
      rec({ assistanceUsed: false, score: 700, maxScore: 1000, accuracy: 1 }),
    ]);
    expect(summary.assisted).toEqual({ gamesPlayed: 1, averageScoreShare: 0.5, averageAccuracy: 0.5 });
    expect(summary.unassisted.gamesPlayed).toBe(2);
    expect(summary.unassisted.averageScoreShare).toBeCloseTo(0.8);
  });

  it("ranks personal bests by share of max score, not raw score", () => {
    const highRaw = rec({ score: 900, maxScore: 1200 }); // 75%
    const highShare = rec({ score: 800, maxScore: 900 }); // 89%
    expect(personalBest([highRaw, highShare], KEY)).toBe(highShare);
    expect(scoreShare(highShare)).toBeCloseTo(0.889, 3);
  });

  it("only compares results under the same game, difficulty and scoring version", () => {
    const current = rec({ score: 500, maxScore: 1000 });
    const otherRules = rec({ score: 1000, maxScore: 1000, scoringVersion: 2 });
    const otherDifficulty = rec({ score: 1000, maxScore: 1000, difficulty: "director" });
    expect(personalBest([current, otherRules, otherDifficulty], KEY)).toBe(current);
  });

  it("breaks ties by raw score, then by the earlier round", () => {
    const early = rec({ score: 500, maxScore: 1000, completedAt: "2026-10-01T00:00:00.000Z" });
    const late = rec({ score: 500, maxScore: 1000, completedAt: "2026-10-02T00:00:00.000Z" });
    const bigger = rec({ score: 600, maxScore: 1200 });
    expect(personalBest([late, early], KEY)).toBe(early);
    expect(personalBest([late, early, bigger], KEY)).toBe(bigger);
  });

  it("returns recent rounds newest first", () => {
    const a = rec({ completedAt: "2026-10-01T00:00:00.000Z" });
    const b = rec({ completedAt: "2026-10-03T00:00:00.000Z" });
    const c = rec({ completedAt: "2026-10-02T00:00:00.000Z" });
    expect(recentResults([a, b, c], 2)).toEqual([b, c]);
  });
});
