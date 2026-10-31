import { describe, expect, it } from "vitest";
import { addResult, earnedXp } from "./ledger";
import { emptyCareerSave } from "./schema";
import { resultInput } from "./test-fixtures";

describe("career ledger", () => {
  it("records a round with its XP award", () => {
    const { save, record, duplicate, award } = addResult(emptyCareerSave(), "s1", resultInput({ score: 700 }));
    expect(duplicate).toBe(false);
    expect(award).toEqual({ xp: 35, reason: "score" });
    expect(record).toMatchObject({ id: "s1", xpAwarded: 35 });
    expect(save.records).toHaveLength(1);
    expect(earnedXp(save.records)).toBe(35);
  });

  it("is idempotent per session id", () => {
    const first = addResult(emptyCareerSave(), "s1", resultInput({ score: 700 }));
    const again = addResult(first.save, "s1", resultInput({ score: 999, completedAt: "2026-10-31T00:00:00.000Z" }));
    expect(again.duplicate).toBe(true);
    expect(again.save).toBe(first.save);
    expect(again.record.xpAwarded).toBe(35);
    expect(again.change.promoted).toBe(false);
  });

  it("creates a new record for every new session (repeat plays)", () => {
    let save = emptyCareerSave();
    for (let i = 0; i < 3; i++) save = addResult(save, `s${i}`, resultInput({ seed: `RR-${i}`, score: 400 })).save;
    expect(save.records).toHaveLength(3);
    expect(earnedXp(save.records)).toBe(60);
  });

  it("records timed-out, zero-score and assisted rounds", () => {
    let save = emptyCareerSave();
    const timedOut = addResult(save, "t", resultInput({ seed: "RR-T", completion: "timedOut", score: 0, errorsFixed: 0, accuracy: null }));
    save = timedOut.save;
    expect(timedOut.record).toMatchObject({ completion: "timedOut", xpAwarded: 0 });
    expect(timedOut.award?.reason).toBe("noScore");
    const assisted = addResult(save, "a", resultInput({ seed: "RR-A", assistanceUsed: true, score: 700 }));
    expect(assisted.record).toMatchObject({ assistanceUsed: true, xpAwarded: 35 });
  });

  it("does not pay twice for the same seeded case", () => {
    const first = addResult(emptyCareerSave(), "s1", resultInput({ seed: "RR-SAME", score: 1000 }));
    const replay = addResult(first.save, "s2", resultInput({ seed: "RR-SAME", score: 1000 }));
    expect(replay.duplicate).toBe(false);
    expect(replay.award).toEqual({ xp: 0, reason: "repeatCase" });
    expect(replay.save.records).toHaveLength(2);
  });

  it("reports promotions using the employee's baseline XP", () => {
    const result = addResult(emptyCareerSave(), "s1", resultInput({ score: 1000 }), 260); // 260 + 50 = 310 ≥ 300
    expect(result.change).toMatchObject({ promoted: true, xpBefore: 260, xpAfter: 310 });
    expect(result.change.rankAfter.title).toBe("Intern");
  });
});
