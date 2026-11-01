import { describe, expect, it } from "vitest";
import { CONTRIBUTION_RULES, capPlayerTotal, findRuleProblems, normalizeEvent, roundQuality } from "./contribution";
import { LIVE_GAME_RULES, PLANNED_GAME_RULES, PREVIEW_GAME_RULES, RECONCILIATION_RUSH_RULE, type GameContributionRule } from "./games";
import { METRIC_IDS, demoAggregate, liveAggregate, rushEvent } from "./test-fixtures";
import { aggregatePeriod } from "./contribution";
import type { ContributionEvent } from "./types";

const plannedRule = PLANNED_GAME_RULES.find((r) => r.gameId === "ticket-queue")!;

describe("roundQuality", () => {
  it("is 1 for a perfect round and 0 for an empty one", () => {
    expect(roundQuality({ score: 1000, maxScore: 1000, objectivesCompleted: 5, objectivesTotal: 5, mistakes: 0 })).toBe(1);
    expect(roundQuality({ score: 0, maxScore: 1000, objectivesCompleted: 0, objectivesTotal: 5, mistakes: 0 })).toBe(0);
  });

  it("weights score share, resolution and precision 40/40/20", () => {
    // scoreShare 0.5, resolution 3/5, precision 3/4
    const quality = roundQuality({ score: 500, maxScore: 1000, objectivesCompleted: 3, objectivesTotal: 5, mistakes: 1 });
    expect(quality).toBeCloseTo(0.4 * 0.5 + 0.4 * 0.6 + 0.2 * 0.75, 12);
  });

  it("stays within [0, 1] at the boundaries", () => {
    expect(roundQuality({ score: 2000, maxScore: 1000, objectivesCompleted: 5, objectivesTotal: 5, mistakes: 0 })).toBe(1);
    expect(roundQuality({ score: 10, maxScore: 0, objectivesCompleted: 0, objectivesTotal: 0, mistakes: 0 })).toBe(0);
    expect(roundQuality({ score: 0, maxScore: 1000, objectivesCompleted: 0, objectivesTotal: 5, mistakes: 7 })).toBe(0);
  });
});

describe("normalizeEvent", () => {
  it("gives 100 points for a perfect round", () => {
    expect(normalizeEvent(rushEvent(), RECONCILIATION_RUSH_RULE)).toBe(CONTRIBUTION_RULES.basePoints);
  });

  it("reduces timed-out and assisted rounds", () => {
    expect(normalizeEvent(rushEvent({ completion: "timedOut" }), RECONCILIATION_RUSH_RULE)).toBe(75);
    expect(normalizeEvent(rushEvent({ assisted: true }), RECONCILIATION_RUSH_RULE)).toBe(80);
    expect(normalizeEvent(rushEvent({ assisted: true, completion: "timedOut" }), RECONCILIATION_RUSH_RULE)).toBe(60);
  });

  it("applies the difficulty weight", () => {
    const event = rushEvent({ gameId: plannedRule.gameId, difficulty: "senior", provenance: "demo" });
    expect(normalizeEvent(event, plannedRule)).toBe(125);
  });

  it("scores relative to the round's maximum, not raw points", () => {
    const small = rushEvent({ score: 400, maxScore: 800 });
    const large = rushEvent({ score: 600, maxScore: 1200 });
    expect(normalizeEvent(small, RECONCILIATION_RUSH_RULE)).toBe(normalizeEvent(large, RECONCILIATION_RUSH_RULE));
  });
});

describe("capPlayerTotal", () => {
  it.each([
    [0, 0],
    [150, 150],
    [300, 300],
    [301, 300.5],
    [400, 350],
    [500, 400],
    [1_000_000, 400],
    [-20, 0],
  ])("credits %d raw points as %d", (raw, credited) => {
    expect(capPlayerTotal(raw)).toBe(credited);
  });
});

describe("aggregatePeriod", () => {
  it("caps each player's credited points per period, in completion order", () => {
    const events = Array.from({ length: 6 }, (_, i) => rushEvent({ eventId: `e${i}`, completedAt: `2026-08-0${i + 1}T10:00:00.000Z` }));
    const { contributions } = liveAggregate(events);
    expect(contributions.accepted.map((c) => c.creditedPoints)).toEqual([100, 100, 100, 50, 50, 0]);
    expect(contributions.totalRaw).toBe(600);
    expect(contributions.totalCredited).toBe(CONTRIBUTION_RULES.playerHardCap);
  });

  it("never lets rounding push a player past the cap", () => {
    // Timed-out rounds are worth 75; the taper creates half points (337.5, 375).
    const events = Array.from({ length: 8 }, (_, i) => rushEvent({ eventId: `t${i}`, completion: "timedOut", completedAt: `2026-08-0${i + 1}T10:00:00.000Z` }));
    const { contributions } = liveAggregate(events);
    expect(contributions.accepted.map((c) => c.creditedPoints)).toEqual([75, 75, 75, 75, 38, 37, 25, 0]);
    expect(contributions.totalCredited).toBe(CONTRIBUTION_RULES.playerHardCap);
  });

  it("caps players independently", () => {
    const events = ["a", "b"].flatMap((player) =>
      Array.from({ length: 5 }, (_, i) => rushEvent({ eventId: `${player}${i}`, playerId: player })),
    );
    const { contributions } = liveAggregate(events);
    expect(contributions.totalCredited).toBe(800);
    expect(contributions.activeContributors).toBe(2);
  });

  it("rewards many casual players over one grinder with the same playtime", () => {
    const grinder = Array.from({ length: 10 }, (_, i) => rushEvent({ eventId: `g${i}`, playerId: "grinder" }));
    const casual = Array.from({ length: 10 }, (_, i) => rushEvent({ eventId: `c${i}`, playerId: `casual-${i}` }));
    expect(liveAggregate(casual).contributions.totalCredited).toBeGreaterThan(liveAggregate(grinder).contributions.totalCredited * 2);
  });

  it("rejects duplicate event ids", () => {
    const event = rushEvent({ eventId: "same" });
    const { contributions } = liveAggregate([event, { ...event }]);
    expect(contributions.accepted).toHaveLength(1);
    expect(contributions.rejected).toEqual([{ eventId: "same", reason: "duplicate" }]);
  });

  it("rejects a seed the player already completed, in this or an earlier period", () => {
    const first = rushEvent({ eventId: "first", seed: "S1", completedAt: "2026-07-02T00:00:00.000Z" });
    const replay = rushEvent({ eventId: "replay", seed: "S1", completedAt: "2026-07-03T00:00:00.000Z" });
    expect(liveAggregate([replay, first]).contributions.rejected).toEqual([{ eventId: "replay", reason: "seedReplay" }]);

    const { ledger } = liveAggregate([first]);
    const later = rushEvent({ eventId: "later", seed: "S1", completedAt: "2026-10-03T00:00:00.000Z" });
    const next = aggregatePeriod([later], {
      periodId: "2026-Q4",
      provenance: "server-verified",
      rules: LIVE_GAME_RULES,
      metricIds: METRIC_IDS,
      ledger,
    });
    expect(next.contributions.rejected).toEqual([{ eventId: "later", reason: "seedReplay" }]);
    expect(next.contributions.totalCredited).toBe(0);
  });

  it("allows the same seed for different players", () => {
    const events = [rushEvent({ eventId: "a", playerId: "a", seed: "S" }), rushEvent({ eventId: "b", playerId: "b", seed: "S" })];
    expect(liveAggregate(events).contributions.accepted).toHaveLength(2);
  });

  it.each<[string, Partial<ContributionEvent>]>([
    ["NaN score", { score: Number.NaN }],
    ["infinite score", { score: Number.POSITIVE_INFINITY }],
    ["negative score", { score: -1 }],
    ["score above maximum", { score: 1001, maxScore: 1000 }],
    ["zero maximum", { score: 0, maxScore: 0 }],
    ["more objectives than exist", { objectivesCompleted: 6, objectivesTotal: 5 }],
    ["fractional mistakes", { mistakes: 0.5 }],
    ["negative mistakes", { mistakes: -1 }],
    ["unknown completion", { completion: "abandoned" as ContributionEvent["completion"] }],
    ["unparseable timestamp", { completedAt: "yesterday" }],
    ["empty event id", { eventId: "" }],
    ["empty player id", { playerId: "" }],
    ["oversized id", { playerId: "x".repeat(129) }],
    ["fractional scoring version", { scoringVersion: 1.5 }],
    ["zero formula version", { formulaVersion: 0 }],
  ])("rejects invalid input: %s", (_, overrides) => {
    const { contributions } = liveAggregate([rushEvent({ eventId: "bad", ...overrides })]);
    expect(contributions.accepted).toHaveLength(0);
    expect(contributions.rejected[0].reason).toBe("invalid");
  });

  it("never mixes demo and server-verified events", () => {
    expect(liveAggregate([rushEvent({ provenance: "demo" })]).contributions.rejected[0].reason).toBe("wrongProvenance");
    expect(demoAggregate([rushEvent({ provenance: "server-verified" })]).contributions.rejected[0].reason).toBe("wrongProvenance");
  });

  it("rejects planned games outside the preview", () => {
    const event = rushEvent({ gameId: "ticket-queue" });
    const { contributions } = aggregatePeriod([event], {
      periodId: "2026-Q3",
      provenance: "server-verified",
      rules: PREVIEW_GAME_RULES,
      metricIds: METRIC_IDS,
    });
    expect(contributions.rejected[0].reason).toBe("plannedGame");
    expect(liveAggregate([event]).contributions.rejected[0].reason).toBe("unknownGame");
  });

  it("applies each event's pinned formula version", () => {
    const v2: GameContributionRule = { ...RECONCILIATION_RUSH_RULE, formulaVersion: 2, metricWeights: { "ledger-integrity": 0.5, "close-quality": 0.5 } };
    const events = [rushEvent({ eventId: "v1", playerId: "a", formulaVersion: 1 }), rushEvent({ eventId: "v2", playerId: "b", formulaVersion: 2 })];
    const { contributions } = aggregatePeriod(events, {
      periodId: "2026-Q3",
      provenance: "server-verified",
      rules: [RECONCILIATION_RUSH_RULE, v2],
      metricIds: METRIC_IDS,
    });
    expect(contributions.accepted.map((c) => c.metrics)).toEqual([
      { "ledger-integrity": 70, "close-quality": 30 },
      { "ledger-integrity": 50, "close-quality": 50 },
    ]);
    expect(findRuleProblems([RECONCILIATION_RUSH_RULE, v2])).toEqual([]);
  });

  it("rejects unsupported scoring versions, unknown difficulties and other periods", () => {
    const reasons = (overrides: Partial<ContributionEvent>) => liveAggregate([rushEvent(overrides)]).contributions.rejected[0]?.reason;
    expect(reasons({ scoringVersion: 2 })).toBe("unsupportedScoringVersion");
    expect(reasons({ formulaVersion: 2 })).toBe("unsupportedFormulaVersion");
    expect(reasons({ formulaVersion: 1 })).toBeUndefined();
    expect(reasons({ difficulty: "senior" })).toBe("unknownDifficulty");
    expect(reasons({ completedAt: "2026-06-30T23:59:59.999Z" })).toBe("outsidePeriod");
    expect(reasons({ completedAt: "2026-07-01T00:00:00.000Z" })).toBeUndefined();
  });

  it("accepts zero-point rounds without counting the player as active", () => {
    const { contributions } = liveAggregate([rushEvent({ score: 0, objectivesCompleted: 0, mistakes: 3 })]);
    expect(contributions.accepted).toHaveLength(1);
    expect(contributions.accepted[0].rawPoints).toBe(0);
    expect(contributions.activeContributors).toBe(0);
  });

  it("produces the same result whatever the input order", () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      rushEvent({
        eventId: `e${i}`,
        playerId: `p${i % 3}`,
        seed: `s${i % 5}`,
        score: 300 + i * 50,
        completedAt: `2026-08-${String(10 + (i % 4)).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const reversed = [...events].reverse();
    const shuffled = [...events].sort((a, b) => (a.eventId.length - b.eventId.length) || b.eventId.localeCompare(a.eventId));
    const expected = liveAggregate(events).contributions;
    expect(liveAggregate(reversed).contributions).toEqual(expected);
    expect(liveAggregate(shuffled).contributions).toEqual(expected);
  });

  it("feeds Reconciliation Rush into Controlling and Finance metrics only, whatever the ledger's business", () => {
    const { contributions } = liveAggregate([rushEvent({ score: 770, maxScore: 1000 })]);
    const credited = contributions.accepted[0].creditedPoints;
    expect(Object.keys(contributions.accepted[0].metrics).sort()).toEqual(["close-quality", "ledger-integrity"]);
    expect(contributions.byMetric["ledger-integrity"] + contributions.byMetric["close-quality"]).toBe(credited);
    expect(contributions.byMetric["ledger-integrity"]).toBeGreaterThan(contributions.byMetric["close-quality"]);
    expect(contributions.byMetric["campaign-effectiveness"]).toBe(0);
  });

  it("reports every configured metric, even with no events", () => {
    const { contributions } = liveAggregate([]);
    expect(Object.keys(contributions.byMetric).sort()).toEqual([...METRIC_IDS].sort());
    expect(contributions.totalCredited).toBe(0);
    expect(contributions.activeContributors).toBe(0);
  });
});

describe("findRuleProblems", () => {
  it("accepts the shipped configuration", () => {
    expect(findRuleProblems(PREVIEW_GAME_RULES)).toEqual([]);
  });

  it("flags unknown metrics, bad shares and duplicates", () => {
    const broken: GameContributionRule = { ...RECONCILIATION_RUSH_RULE, metricWeights: { "ledger-integrity": 0.5, "made-up": 0.2 }, difficultyWeights: { associate: 0 } };
    const problems = findRuleProblems([RECONCILIATION_RUSH_RULE, broken]);
    expect(problems).toEqual(
      expect.arrayContaining([
        "reconciliation-rush: duplicate formula version 1",
        "reconciliation-rush: unknown metric made-up",
        "reconciliation-rush: metric shares sum to 0.7",
        "reconciliation-rush: non-positive weight for difficulty associate",
      ]),
    );
  });
});
