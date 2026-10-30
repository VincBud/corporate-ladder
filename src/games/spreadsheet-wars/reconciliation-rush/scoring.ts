/**
 * Reconciliation Rush scoring. Game points only; Corporate XP is a separate
 * concern (see report.ts) and is not awarded by this module.
 *
 *   Fixed error        easy +100 · medium +150 · hard +200
 *   Incorrect change   −50 each (wrong fix, invalid formula, or a correct cell broken)
 *   Missed error       0 (left unchanged)
 *   Time bonus         up to +300, proportional to time remaining,
 *                      only when all five errors are fixed
 *   Final score        never below 0
 */
import { addressLabel } from "../sheet";
import type { RoundEvaluation } from "./validate";
import type { Difficulty, ErrorCategory } from "./types";

export const DIFFICULTY_POINTS: Record<Difficulty, number> = { easy: 100, medium: 150, hard: 200 };
export const INCORRECT_CORRECTION_PENALTY = 50;
export const MAX_TIME_BONUS = 300;

export const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  dataEntry: "Data entry",
  calculation: "Calculation",
  formula: "Formula",
  reconciliation: "Reconciliation",
};

export interface ScoreLine {
  label: string;
  points: number;
}

export interface ScoreBreakdown {
  lines: ScoreLine[];
  correctionPoints: number;
  /** Zero or negative. */
  penaltyPoints: number;
  timeBonus: number;
  total: number;
  /** Best possible score for this challenge (all fixed, instant finish). */
  maxPossible: number;
}

export function calculateTimeBonus(remainingMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const ratio = Math.min(Math.max(remainingMs / durationMs, 0), 1);
  return Math.round(MAX_TIME_BONUS * ratio);
}

export function scoreRound(evaluation: RoundEvaluation, remainingMs: number, durationMs: number): ScoreBreakdown {
  const lines: ScoreLine[] = [];
  let correctionPoints = 0;
  let maxPossible = MAX_TIME_BONUS;

  for (const outcome of evaluation.errors) {
    const points = DIFFICULTY_POINTS[outcome.error.difficulty];
    maxPossible += points;
    if (outcome.status === "fixed") {
      correctionPoints += points;
      lines.push({
        label: `Fixed ${addressLabel(outcome.error.address)} · ${CATEGORY_LABELS[outcome.error.category]} (${outcome.error.difficulty})`,
        points,
      });
    }
  }

  const penaltyPoints = -INCORRECT_CORRECTION_PENALTY * evaluation.incorrectCount;
  if (evaluation.incorrectCount > 0) {
    lines.push({ label: `Incorrect corrections × ${evaluation.incorrectCount}`, points: penaltyPoints });
  }

  const allFixed = evaluation.errors.length > 0 && evaluation.fixedCount === evaluation.errors.length;
  const timeBonus = allFixed ? calculateTimeBonus(remainingMs, durationMs) : 0;
  lines.push({ label: allFixed ? "Time bonus" : "Time bonus (requires all errors fixed)", points: timeBonus });

  return {
    lines,
    correctionPoints,
    penaltyPoints,
    timeBonus,
    total: Math.max(0, correctionPoints + penaltyPoints + timeBonus),
    maxPossible,
  };
}
