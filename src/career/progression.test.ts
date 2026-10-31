import { describe, expect, it } from "vitest";
import { describeProgressChange, getCareerSnapshot, levelForXp, totalXpForLevel } from "./progression";
import { RANKS } from "./ranks";

describe("rank thresholds", () => {
  it("starts every new employee as an Unpaid Intern at level 1", () => {
    expect(getCareerSnapshot(0).rank.title).toBe("Unpaid Intern");
    expect(getCareerSnapshot(0).progress.level).toBe(1);
  });

  it("reaches each rank exactly at its minimum level's XP", () => {
    for (const rank of RANKS) {
      const threshold = totalXpForLevel(rank.minLevel);
      expect(getCareerSnapshot(threshold).rank.id, rank.title).toBe(rank.id);
      if (threshold > 0) expect(getCareerSnapshot(threshold - 1).rank.id, rank.title).not.toBe(rank.id);
    }
  });

  it("matches levels to the XP curve", () => {
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(300)).toBe(3);
  });
});

describe("promotions", () => {
  it("detects a promotion across a rank threshold", () => {
    const change = describeProgressChange(290, 310); // Intern starts at level 3 = 300 XP
    expect(change.promoted).toBe(true);
    expect(change.leveledUp).toBe(true);
    expect(change.rankBefore.title).toBe("Unpaid Intern");
    expect(change.rankAfter.title).toBe("Intern");
  });

  it("distinguishes a level-up without promotion", () => {
    const change = describeProgressChange(90, 110);
    expect(change).toMatchObject({ leveledUp: true, promoted: false, levelBefore: 1, levelAfter: 2 });
  });

  it("handles jumps across several ranks and no change at all", () => {
    expect(describeProgressChange(0, totalXpForLevel(8)).rankAfter.title).toBe("Associate");
    expect(describeProgressChange(150, 150)).toMatchObject({ leveledUp: false, promoted: false });
  });
});
