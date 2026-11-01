import { describe, expect, it } from "vitest";
import { CANONICAL_DEPARTMENTS, CANONICAL_DEPARTMENT_IDS, getCanonicalDepartment } from "@/config/departments";
import type { GameResultRecord } from "@/types/progression";
import { DEPARTMENT_TRACKS, departmentProgress, progressionGames, qualifyingRounds, requirementFor, type MembershipPeriod } from "./department-tracks";

let n = 0;
function round(overrides: Partial<GameResultRecord> = {}): GameResultRecord {
  n++;
  return {
    id: `r${n}`,
    gameId: "reconciliation-rush",
    scoringVersion: 1,
    seed: `RV1-seed-${n}`,
    department: "Marketing",
    difficulty: "associate",
    completedAt: "2026-11-10T10:00:00.000Z",
    completion: "submitted",
    score: 900,
    maxScore: 1050,
    grade: "Exceeds Expectations",
    errorsFixed: 5,
    totalErrors: 5,
    incorrectCorrections: 0,
    accuracy: 1,
    timeUsedMs: 40_000,
    timeRemainingMs: 50_000,
    assistanceUsed: false,
    xpAwarded: 45,
    ...overrides,
  };
}

const since = (departmentId: string, startedAt = "2026-11-01T00:00:00.000Z", endedAt: string | null = null): MembershipPeriod => ({ departmentId, startedAt, endedAt });

describe("career tracks", () => {
  it("define one track per canonical department and nothing else", () => {
    expect(Object.keys(DEPARTMENT_TRACKS).sort()).toEqual([...CANONICAL_DEPARTMENT_IDS].sort());
  });

  it.each(CANONICAL_DEPARTMENT_IDS)("%s: 6–8 positions with unique ids and titles, from entry level to the executive suite", (id) => {
    const track = DEPARTMENT_TRACKS[id];
    expect(track.length).toBeGreaterThanOrEqual(6);
    expect(track.length).toBeLessThanOrEqual(8);
    expect(new Set(track.map((p) => p.id)).size).toBe(track.length);
    expect(new Set(track.map((p) => p.title)).size).toBe(track.length);
    expect(track[0].title).toMatch(/Intern/);
    expect(track.at(-1)!.title).toMatch(/^(Chief|General Counsel)/);
    expect(track.every((p) => p.summary.length > 10)).toBe(true);
  });

  it("aren't the same titles with a different prefix", () => {
    const middles = CANONICAL_DEPARTMENT_IDS.map((id) => DEPARTMENT_TRACKS[id].slice(1, -1).map((p) => p.title).join("|"));
    expect(new Set(middles).size).toBe(middles.length);
  });

  it("use the requested examples for Finance, Controlling, Sales and Human Resources", () => {
    expect(DEPARTMENT_TRACKS.finance.map((p) => p.title)).toEqual([
      "Finance Intern", "Junior Analyst", "Analyst", "Senior Analyst", "Associate", "Vice President", "Managing Director", "Chief Financial Officer",
    ]);
    expect(DEPARTMENT_TRACKS.controlling.at(-1)!.title).toBe("Chief Financial Officer");
    expect(DEPARTMENT_TRACKS.sales.map((p) => p.title)).toContain("Sales Development Representative");
    expect(DEPARTMENT_TRACKS.people.at(-1)!.title).toBe("Chief Human Resources Officer");
  });

  it("use the registry's names, including Corporate Strategy", () => {
    expect(getCanonicalDepartment("strategy").name).toBe("Corporate Strategy");
    expect(CANONICAL_DEPARTMENTS.every((d) => d.introduction && d.responsibilities.length >= 3)).toBe(true);
  });
});

describe("progression policy", () => {
  it("lets only departments with a live game earn positions through play", () => {
    expect(progressionGames("controlling").map((g) => g.gameId)).toEqual(["reconciliation-rush"]);
    expect(progressionGames("finance").map((g) => g.gameId)).toEqual(["reconciliation-rush"]);
    expect(progressionGames("sales").map((g) => g.gameId)).toEqual(["pipeline-panic"]);
    for (const id of ["people", "operations", "it", "marketing", "legal", "strategy"]) expect(progressionGames(id)).toEqual([]);
  });

  it("requires 3 and 10 qualifying rounds for tiers 1 and 2, and a Quarterly Performance Review above", () => {
    expect(requirementFor("controlling", 0)).toEqual({ kind: "entry" });
    expect(requirementFor("controlling", 1)).toMatchObject({ kind: "verifiedRounds", rounds: 3 });
    expect(requirementFor("controlling", 2)).toMatchObject({ kind: "verifiedRounds", rounds: 10 });
    expect(requirementFor("controlling", 3)).toEqual({ kind: "performanceReview" });
    expect(requirementFor("sales", 1)).toEqual({ kind: "verifiedRounds", rounds: 3, games: ["Pipeline Panic"] });
    expect(requirementFor("marketing", 1)).toEqual({ kind: "departmentGameplay", plannedGames: ["Inbox Simulator", "Campaign Calendar"] });
    expect(requirementFor("legal", 1, ["Contract Redline"])).toEqual({ kind: "departmentGameplay", plannedGames: ["Contract Redline"] });
  });

  it("starts everyone at the entry position", () => {
    expect(departmentProgress("controlling", [since("controlling")], [])).toMatchObject({ positionIndex: 0, qualifyingRounds: 0, next: { index: 1, remaining: 3 } });
  });

  it("promotes Controlling with qualifying verified rounds played while a member", () => {
    const rounds = Array.from({ length: 3 }, () => round());
    expect(departmentProgress("controlling", [since("controlling")], rounds)).toMatchObject({ positionIndex: 1, next: { index: 2, remaining: 7 } });
    const ten = Array.from({ length: 10 }, () => round());
    expect(departmentProgress("controlling", [since("controlling")], ten)).toMatchObject({ positionIndex: 2, next: { index: 3, requirement: { kind: "performanceReview" }, remaining: null } });
    // Never beyond tier 2 through play.
    const many = Array.from({ length: 200 }, () => round());
    expect(departmentProgress("finance", [since("finance")], many).positionIndex).toBe(2);
  });

  it("never promotes departments without relevant gameplay, however much XP the player has", () => {
    const many = Array.from({ length: 50 }, () => round({ xpAwarded: 1_000 }));
    for (const id of ["marketing", "people", "legal", "strategy"] as const) {
      expect(departmentProgress(id, [since(id)], many)).toMatchObject({ positionIndex: 0, next: { index: 1, requirement: { kind: "departmentGameplay" } } });
    }
  });

  it("only counts rounds completed during a membership in that department", () => {
    const memberships = [since("finance", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"), since("controlling", "2026-11-01T00:00:00.000Z")];
    const rounds = [
      round({ completedAt: "2026-09-30T23:59:59.000Z" }), // before joining anything
      round({ completedAt: "2026-10-15T00:00:00.000Z" }), // Finance
      round({ completedAt: "2026-10-31T23:59:59.999Z" }), // Finance (last moment)
      round({ completedAt: "2026-11-01T00:00:00.000Z" }), // Controlling (first moment)
    ];
    expect(qualifyingRounds("finance", memberships, rounds)).toBe(2);
    expect(qualifyingRounds("controlling", memberships, rounds)).toBe(1);
  });

  it("keeps earned positions: returning to a department resumes the career there", () => {
    const memberships = [
      since("controlling", "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"),
      since("sales", "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      since("controlling", "2026-09-01T00:00:00.000Z"),
    ];
    const rounds = [
      ...Array.from({ length: 2 }, () => round({ completedAt: "2026-07-15T00:00:00.000Z" })),
      ...Array.from({ length: 5 }, () => round({ completedAt: "2026-08-15T00:00:00.000Z" })), // while in Sales: don't count for Controlling
      round({ completedAt: "2026-09-02T00:00:00.000Z" }),
    ];
    expect(departmentProgress("controlling", memberships, rounds)).toMatchObject({ positionIndex: 1, qualifyingRounds: 3 });
    expect(departmentProgress("sales", memberships, rounds).positionIndex).toBe(0);
  });

  it("doesn't count timed-out, low-quality, replayed or other games' rounds", () => {
    const rounds = [
      round({ completion: "timedOut" }),
      round({ errorsFixed: 3 }), // 60% < 80%
      round({ seed: "RV1-same" }),
      round({ seed: "RV1-same" }),
      round({ gameId: "pipeline-panic" }),
      round({ errorsFixed: 4 }), // exactly 80%
    ];
    expect(qualifyingRounds("controlling", [since("controlling")], rounds)).toBe(2);
  });
});
