/**
 * The recurring Daily Challenges (client-safe). Must match
 * public.daily_assignments (a PGlite test compares them).
 *
 * Every registered employee gets the same puzzle per assignment and UTC day,
 * with one ranked attempt. The puzzle seed is chosen and kept by the server.
 */
import type { AppId } from "@/types/app";
import type { GameId } from "@/types/progression";

export const DAILY_ASSIGNMENT_IDS = ["daily-audit", "daily-sales-briefing"] as const;
export type DailyAssignmentId = (typeof DAILY_ASSIGNMENT_IDS)[number];

export interface DailyAssignment {
  id: DailyAssignmentId;
  gameId: GameId;
  title: string;
  gameName: string;
  description: string;
  /** Where unlimited practice of the same game lives. */
  practiceApp: AppId;
  /** Version of the daily generation strategy (see docs/daily-challenges.md). */
  generationVersion: number;
}

export const DAILY_ASSIGNMENTS: readonly DailyAssignment[] = [
  {
    id: "daily-audit",
    gameId: "reconciliation-rush",
    title: "Daily Audit",
    gameName: "Reconciliation Rush",
    description: "Today's shared ledger: find and correct the five discrepancies against the source documents in 90 seconds.",
    practiceApp: "spreadsheet-wars",
    generationVersion: 1,
  },
  {
    id: "daily-sales-briefing",
    gameId: "pipeline-panic",
    title: "Daily Sales Briefing",
    gameName: "Pipeline Panic",
    description: "Today's shared pipeline: decide every opportunity against today's playbook before the quarter closes in 90 seconds.",
    practiceApp: "pipeline-panic",
    generationVersion: 1,
  },
];

export const isDailyAssignmentId = (value: unknown): value is DailyAssignmentId =>
  typeof value === "string" && (DAILY_ASSIGNMENT_IDS as readonly string[]).includes(value);

export const getDailyAssignment = (id: DailyAssignmentId) => DAILY_ASSIGNMENTS.find((a) => a.id === id)!;

/** The UTC calendar date (YYYY-MM-DD) of an instant. Daily boundaries are always UTC. */
export const utcDate = (at: Date) => at.toISOString().slice(0, 10);

/** The next UTC midnight after an instant. */
export function nextUtcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
}
