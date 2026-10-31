/**
 * Corporate Simulation types.
 *
 * Everything here is fictional in-game data. Money is whole CorpBucks (CB).
 * Individual Corporate XP never appears in this module: the company only
 * sees normalized contribution points derived from verified results.
 */

/** Calendar quarter, e.g. "2026-Q3". */
export type PeriodId = `${number}-Q${1 | 2 | 3 | 4}`;

/** Operating departments: the canonical ids that have operational metrics (see config/departments.ts). */
export const DEPARTMENT_IDS = ["finance", "controlling", "people", "sales", "operations", "it", "marketing"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** Kinds of work a minigame exercises. Departments list the ones they care about. */
export type GameplayCategory =
  | "accounting"
  | "reconciliation"
  | "forecasting"
  | "expense-control"
  | "people-operations"
  | "communication"
  | "negotiation"
  | "logistics"
  | "troubleshooting"
  | "campaign-planning";

/**
 * Where an event came from. The engine refuses to mix sources: a live
 * snapshot only accepts server-verified events and the preview only demo ones.
 */
export type Provenance = "server-verified" | "demo";

/**
 * One finished round, as the company sees it. Built by the server from a
 * verified game result (see source.ts), or by the demo generator.
 * Deliberately has no XP field.
 */
export interface ContributionEvent {
  /** Unique per round (the verified result's session id). Duplicate protection key. */
  eventId: string;
  playerId: string;
  gameId: string;
  scoringVersion: number;
  difficulty: string;
  /** Puzzle seed. A player earns company contribution once per seed. */
  seed: string;
  /** ISO 8601 timestamp; decides the period. */
  completedAt: string;
  score: number;
  maxScore: number;
  /** Game objectives met, e.g. discrepancies fixed. */
  objectivesCompleted: number;
  objectivesTotal: number;
  /** Wrong actions, e.g. incorrect corrections. */
  mistakes: number;
  completion: "submitted" | "timedOut";
  assisted: boolean;
  provenance: Provenance;
  /** Formula version the server pinned when it recorded the event. Absent for demo events. */
  formulaVersion?: number;
}
