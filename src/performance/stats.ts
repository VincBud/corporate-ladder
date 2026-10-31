/**
 * Player performance selectors over the round history. Pure; every average
 * returns null for an empty dataset instead of NaN or 0.
 */
import type { GameId, GameResultRecord } from "@/types/progression";
import { earnedXp } from "./ledger";

/**
 * Comparison rule for personal bests: results are only comparable within the
 * same game, difficulty and scoring version, and are ranked by score as a
 * share of that round's maximum (seeds have different maxima).
 */
export function comparisonKey(record: Pick<GameResultRecord, "gameId" | "difficulty" | "scoringVersion">): string {
  return `${record.gameId}|${record.difficulty}|v${record.scoringVersion}`;
}

export function scoreShare(record: Pick<GameResultRecord, "score" | "maxScore">): number {
  return record.maxScore > 0 ? Math.min(1, Math.max(0, record.score / record.maxScore)) : 0;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export interface SegmentStats {
  gamesPlayed: number;
  averageScoreShare: number | null;
  averageAccuracy: number | null;
}

export interface PerformanceSummary extends SegmentStats {
  totalXp: number;
  totalErrorsFixed: number;
  totalErrors: number;
  averageScore: number | null;
  assisted: SegmentStats;
  unassisted: SegmentStats;
}

function segment(records: readonly GameResultRecord[]): SegmentStats {
  return {
    gamesPlayed: records.length,
    averageScoreShare: mean(records.map(scoreShare)),
    // Rounds without any attempted correction have no accuracy and are skipped.
    averageAccuracy: mean(records.flatMap((r) => (r.accuracy === null ? [] : [r.accuracy]))),
  };
}

export function summarizePerformance(records: readonly GameResultRecord[], gameId?: GameId): PerformanceSummary {
  const scoped = gameId ? records.filter((r) => r.gameId === gameId) : records;
  return {
    ...segment(scoped),
    totalXp: earnedXp(scoped),
    totalErrorsFixed: scoped.reduce((sum, r) => sum + r.errorsFixed, 0),
    totalErrors: scoped.reduce((sum, r) => sum + r.totalErrors, 0),
    averageScore: mean(scoped.map((r) => r.score)),
    assisted: segment(scoped.filter((r) => r.assistanceUsed)),
    unassisted: segment(scoped.filter((r) => !r.assistanceUsed)),
  };
}

/** Best result among records comparable to `key`; ties go to the higher raw score, then the earlier round. */
export function personalBest(records: readonly GameResultRecord[], key: string): GameResultRecord | null {
  let best: GameResultRecord | null = null;
  for (const record of records) {
    if (comparisonKey(record) !== key) continue;
    if (
      !best ||
      scoreShare(record) > scoreShare(best) ||
      (scoreShare(record) === scoreShare(best) && record.score > best.score) ||
      (scoreShare(record) === scoreShare(best) && record.score === best.score && record.completedAt < best.completedAt)
    ) {
      best = record;
    }
  }
  return best;
}

/** Newest first. */
export function recentResults(records: readonly GameResultRecord[], limit = 5): GameResultRecord[] {
  return [...records].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, limit);
}
