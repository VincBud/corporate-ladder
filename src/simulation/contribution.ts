/**
 * Turns finished rounds into company contribution points.
 *
 * Contribution is separate from Corporate XP: XP rewards the individual
 * (floor(score / 20), uncapped), contribution measures useful work for the
 * company and is normalized and capped.
 *
 * Per event:
 *   scoreShare = score / maxScore
 *   resolution = objectivesCompleted / objectivesTotal
 *   precision  = objectivesCompleted / (objectivesCompleted + mistakes)   (0 when nothing was attempted)
 *   quality    = 0.4 · scoreShare + 0.4 · resolution + 0.2 · precision    ∈ [0, 1]
 *   points     = round(100 · quality · difficulty · completion · assistance)
 *     completion: submitted 1.0, timed out 0.75
 *     assistance: unassisted 1.0, assisted 0.8
 *
 * Per player and period (applied in completion order):
 *   full credit up to 300 points, then half credit, never more than 400 in total.
 *   That is about three strong rounds at full value; beyond ~5 rounds nothing counts.
 *
 * These rules are formula version 1 (see GameContributionRule.formulaVersion).
 *
 * Rejected: invalid figures, the wrong provenance, unknown games, scoring
 * versions, formula versions or difficulties, planned games in live mode, events outside the
 * period, duplicate event ids, and a seed the player already completed
 * (in any period).
 */
import { getMetric } from "./departments";
import type { GameContributionRule } from "./games";
import { periodOf } from "./periods";
import type { ContributionEvent, PeriodId, Provenance } from "./types";

export const CONTRIBUTION_RULES = {
  basePoints: 100,
  weights: { scoreShare: 0.4, resolution: 0.4, precision: 0.2 },
  timedOutFactor: 0.75,
  assistedFactor: 0.8,
  playerSoftCap: 300,
  playerHardCap: 400,
  taperRate: 0.5,
} as const;

export type RejectionReason =
  | "invalid"
  | "wrongProvenance"
  | "unknownGame"
  | "plannedGame"
  | "unsupportedScoringVersion"
  | "unsupportedFormulaVersion"
  | "unknownDifficulty"
  | "outsidePeriod"
  | "duplicate"
  | "seedReplay";

export interface CreditedContribution {
  eventId: string;
  playerId: string;
  gameId: string;
  /** Normalized points before the player cap. */
  rawPoints: number;
  /** Points that count after the player cap. */
  creditedPoints: number;
  /** Metric id → credited points. */
  metrics: Record<string, number>;
}

export interface PeriodContributions {
  periodId: PeriodId;
  accepted: CreditedContribution[];
  rejected: { eventId: string; reason: RejectionReason }[];
  /** Metric id → credited points. Every configured metric is present. */
  byMetric: Record<string, number>;
  totalRaw: number;
  totalCredited: number;
  /** Players with at least one accepted round worth more than 0 points. */
  activeContributors: number;
}

/** Carried between periods so duplicates and replays are caught across quarters. */
export interface ContributionLedgerState {
  eventIds: ReadonlySet<string>;
  seedKeys: ReadonlySet<string>;
}

export const EMPTY_LEDGER_STATE: ContributionLedgerState = { eventIds: new Set(), seedKeys: new Set() };

const isCount = (value: number) => Number.isInteger(value) && value >= 0;
const isId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128;

/** Structural checks that don't depend on configuration. */
export function isValidEvent(event: ContributionEvent): boolean {
  return (
    isId(event.eventId) &&
    isId(event.playerId) &&
    isId(event.gameId) &&
    isId(event.seed) &&
    typeof event.difficulty === "string" &&
    Number.isInteger(event.scoringVersion) &&
    Number.isFinite(event.score) &&
    Number.isFinite(event.maxScore) &&
    event.maxScore > 0 &&
    event.score >= 0 &&
    event.score <= event.maxScore &&
    isCount(event.objectivesTotal) &&
    isCount(event.objectivesCompleted) &&
    event.objectivesCompleted <= event.objectivesTotal &&
    isCount(event.mistakes) &&
    (event.completion === "submitted" || event.completion === "timedOut") &&
    typeof event.assisted === "boolean" &&
    (event.formulaVersion === undefined || (Number.isInteger(event.formulaVersion) && event.formulaVersion > 0)) &&
    periodOf(event.completedAt) !== null
  );
}

/** Quality of one round in [0, 1]. */
export function roundQuality(event: Pick<ContributionEvent, "score" | "maxScore" | "objectivesCompleted" | "objectivesTotal" | "mistakes">): number {
  const { weights } = CONTRIBUTION_RULES;
  const scoreShare = event.maxScore > 0 ? Math.min(Math.max(event.score / event.maxScore, 0), 1) : 0;
  const resolution = event.objectivesTotal > 0 ? event.objectivesCompleted / event.objectivesTotal : 0;
  const attempts = event.objectivesCompleted + event.mistakes;
  const precision = attempts > 0 ? event.objectivesCompleted / attempts : 0;
  return weights.scoreShare * scoreShare + weights.resolution * resolution + weights.precision * precision;
}

/** Normalized points for one valid round, before the player cap. */
export function normalizeEvent(event: ContributionEvent, rule: GameContributionRule): number {
  const difficulty = rule.difficultyWeights[event.difficulty] ?? 0;
  const completion = event.completion === "submitted" ? 1 : CONTRIBUTION_RULES.timedOutFactor;
  const assistance = event.assisted ? CONTRIBUTION_RULES.assistedFactor : 1;
  return Math.round(CONTRIBUTION_RULES.basePoints * roundQuality(event) * difficulty * completion * assistance);
}

/** Total credited points for a player's raw total in one period. */
export function capPlayerTotal(raw: number): number {
  const { playerSoftCap, playerHardCap, taperRate } = CONTRIBUTION_RULES;
  if (raw <= playerSoftCap) return Math.max(0, raw);
  return Math.min(playerHardCap, playerSoftCap + (raw - playerSoftCap) * taperRate);
}

/** Splits points across metrics; rounding leftovers go to the largest share so totals stay exact. */
function splitAcrossMetrics(points: number, weights: Readonly<Record<string, number>>): Record<string, number> {
  const entries = Object.entries(weights).sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b));
  const split: Record<string, number> = {};
  let assigned = 0;
  for (const [metric, weight] of entries.slice(1)) {
    split[metric] = Math.floor(points * weight);
    assigned += split[metric];
  }
  if (entries.length > 0) split[entries[0][0]] = points - assigned;
  return split;
}

const compareEvents = (a: ContributionEvent, b: ContributionEvent) =>
  a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;

export interface AggregateOptions {
  periodId: PeriodId;
  provenance: Provenance;
  rules: readonly GameContributionRule[];
  /** Metric ids to report (every configured metric). */
  metricIds: readonly string[];
  ledger?: ContributionLedgerState;
}

/**
 * Credits one period's events. Input order doesn't matter: events are
 * processed by completion time, then event id.
 */
export function aggregatePeriod(
  events: readonly ContributionEvent[],
  options: AggregateOptions,
): { contributions: PeriodContributions; ledger: ContributionLedgerState } {
  const versionsByGame = new Map<string, GameContributionRule[]>();
  for (const rule of options.rules) versionsByGame.set(rule.gameId, [...(versionsByGame.get(rule.gameId) ?? []), rule]);
  // An event pinned to a formula version uses exactly that version; unpinned (demo) events use the newest.
  const ruleFor = (event: ContributionEvent): GameContributionRule | "unknownGame" | "unsupportedFormulaVersion" => {
    const versions = versionsByGame.get(event.gameId);
    if (!versions) return "unknownGame";
    if (event.formulaVersion === undefined) return versions.reduce((a, b) => (b.formulaVersion > a.formulaVersion ? b : a));
    return versions.find((v) => v.formulaVersion === event.formulaVersion) ?? "unsupportedFormulaVersion";
  };
  const eventIds = new Set(options.ledger?.eventIds ?? []);
  const seedKeys = new Set(options.ledger?.seedKeys ?? []);
  const rawByPlayer = new Map<string, number>();
  const accepted: CreditedContribution[] = [];
  const rejected: PeriodContributions["rejected"] = [];
  const byMetric: Record<string, number> = Object.fromEntries(options.metricIds.map((id) => [id, 0]));

  const rejection = (event: ContributionEvent): RejectionReason | null => {
    if (!isValidEvent(event)) return "invalid";
    if (event.provenance !== options.provenance) return "wrongProvenance";
    const rule = ruleFor(event);
    if (typeof rule === "string") return rule;
    if (rule.status === "planned" && options.provenance !== "demo") return "plannedGame";
    if (!rule.scoringVersions.includes(event.scoringVersion)) return "unsupportedScoringVersion";
    if (!(event.difficulty in rule.difficultyWeights)) return "unknownDifficulty";
    if (periodOf(event.completedAt) !== options.periodId) return "outsidePeriod";
    if (eventIds.has(event.eventId)) return "duplicate";
    if (seedKeys.has(seedKey(event))) return "seedReplay";
    return null;
  };

  for (const event of [...events].sort(compareEvents)) {
    const reason = rejection(event);
    if (reason) {
      rejected.push({ eventId: typeof event.eventId === "string" ? event.eventId : "", reason });
      // A replay or duplicate still marks the id as seen; invalid events don't.
      if (reason === "seedReplay") eventIds.add(event.eventId);
      continue;
    }
    eventIds.add(event.eventId);
    seedKeys.add(seedKey(event));

    const rule = ruleFor(event) as GameContributionRule;
    const rawPoints = normalizeEvent(event, rule);
    const before = rawByPlayer.get(event.playerId) ?? 0;
    rawByPlayer.set(event.playerId, before + rawPoints);
    // Round the running totals, not each step, so a player's credits sum to exactly the capped total.
    const creditedPoints = Math.round(capPlayerTotal(before + rawPoints)) - Math.round(capPlayerTotal(before));

    const metrics = splitAcrossMetrics(creditedPoints, rule.metricWeights);
    for (const [metric, points] of Object.entries(metrics)) {
      if (metric in byMetric) byMetric[metric] += points;
    }
    accepted.push({ eventId: event.eventId, playerId: event.playerId, gameId: event.gameId, rawPoints, creditedPoints, metrics });
  }

  const activePlayers = new Set(accepted.filter((c) => c.rawPoints > 0).map((c) => c.playerId));
  return {
    contributions: {
      periodId: options.periodId,
      accepted,
      rejected,
      byMetric,
      totalRaw: accepted.reduce((sum, c) => sum + c.rawPoints, 0),
      totalCredited: accepted.reduce((sum, c) => sum + c.creditedPoints, 0),
      activeContributors: activePlayers.size,
    },
    ledger: { eventIds, seedKeys },
  };
}

function seedKey(event: ContributionEvent): string {
  return `${event.playerId}\u0000${event.gameId}\u0000${event.seed}`;
}

/** Checks that every rule points at known metrics with shares summing to 1. */
export function findRuleProblems(rules: readonly GameContributionRule[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const rule of rules) {
    const key = `${rule.gameId}@${rule.formulaVersion}`;
    if (ids.has(key)) problems.push(`${rule.gameId}: duplicate formula version ${rule.formulaVersion}`);
    ids.add(key);
    const weights = Object.entries(rule.metricWeights);
    if (weights.length === 0) problems.push(`${rule.gameId}: no metrics`);
    for (const [metric, weight] of weights) {
      if (!getMetric(metric)) problems.push(`${rule.gameId}: unknown metric ${metric}`);
      if (!(weight > 0)) problems.push(`${rule.gameId}: non-positive weight for ${metric}`);
    }
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    if (Math.abs(total - 1) > 1e-9) problems.push(`${rule.gameId}: metric shares sum to ${total}`);
    for (const [difficulty, weight] of Object.entries(rule.difficultyWeights)) {
      if (!(weight > 0)) problems.push(`${rule.gameId}: non-positive weight for difficulty ${difficulty}`);
    }
  }
  return problems;
}
