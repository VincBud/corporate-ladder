import { describe, expect, it } from "vitest";
import { calculateXpAward, xpForScore } from "./xp";

describe("Corporate XP", () => {
  it("converts score to XP at 1 XP per 20 points, rounding down", () => {
    expect(xpForScore(0)).toBe(0);
    expect(xpForScore(19)).toBe(0);
    expect(xpForScore(20)).toBe(1);
    expect(xpForScore(1007)).toBe(50);
    expect(xpForScore(1050)).toBe(52);
  });

  it("never awards negative or invalid XP", () => {
    expect(xpForScore(-500)).toBe(0);
    expect(xpForScore(Number.NaN)).toBe(0);
    expect(xpForScore(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("explains zero-XP rounds", () => {
    expect(calculateXpAward({ gameId: "reconciliation-rush", seed: "RR-A", score: 0 }, [])).toEqual({ xp: 0, reason: "noScore" });
    expect(calculateXpAward({ gameId: "reconciliation-rush", seed: "RR-A", score: 10 }, [])).toEqual({ xp: 0, reason: "noScore" });
    expect(calculateXpAward({ gameId: "reconciliation-rush", seed: "RR-A", score: 400 }, [])).toEqual({ xp: 20, reason: "score" });
  });

  it("pays a seeded case only once", () => {
    const history = [{ gameId: "reconciliation-rush" as const, seed: "RR-A" }];
    expect(calculateXpAward({ gameId: "reconciliation-rush", seed: "RR-A", score: 1000 }, history)).toEqual({ xp: 0, reason: "repeatCase" });
    expect(calculateXpAward({ gameId: "reconciliation-rush", seed: "RR-B", score: 1000 }, history).xp).toBe(50);
  });

  it("explains a worthless replay by its score rather than as a repeat", () => {
    const history = [{ gameId: "reconciliation-rush" as const, seed: "RR-A" }];
    expect(calculateXpAward({ gameId: "reconciliation-rush", seed: "RR-A", score: 0 }, history)).toEqual({ xp: 0, reason: "noScore" });
  });
});
