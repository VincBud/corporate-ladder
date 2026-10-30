/**
 * Task Performance Report: the result screen after a single minigame round.
 *
 * Not to be confused with Quarterly Performance Reviews, a planned long-term
 * career system tied to real calendar quarters. A single round never counts
 * as a quarterly appraisal and never changes career progression on its own.
 */
import { hashSeed } from "./rng";
import type { RoundEvaluation } from "./validate";

export type PerformanceGrade =
  | "Exceeds Expectations"
  | "Meets Expectations"
  | "Needs Improvement"
  | "Schedule a Meeting with HR";

export function gradeRound(evaluation: RoundEvaluation): PerformanceGrade {
  const total = evaluation.errors.length;
  if (total > 0 && evaluation.fixedCount === total && evaluation.incorrectCount === 0) return "Exceeds Expectations";
  if (evaluation.fixedCount >= 3) return "Meets Expectations";
  if (evaluation.fixedCount >= 1) return "Needs Improvement";
  return "Schedule a Meeting with HR";
}

/** Share of attempted corrections that were right; null when nothing was attempted. */
export function correctionAccuracy(evaluation: RoundEvaluation): number | null {
  const attempts = evaluation.fixedCount + evaluation.incorrectCount;
  return attempts === 0 ? null : evaluation.fixedCount / attempts;
}

const FEEDBACK: Record<PerformanceGrade, readonly string[]> = {
  "Exceeds Expectations": [
    "Exceptional attention to detail. Management has decided to reward you with additional responsibilities.",
    "Flawless. We will be mentioning your work in a meeting you are not invited to.",
    "Outstanding. Please document your process so it can be attributed to your manager.",
  ],
  "Meets Expectations": [
    "Solid work. The board will never know how close it was.",
    "Acceptable. Your manager has replied “👍” from the golf course.",
    "Meets expectations, which were set deliberately low. Well done.",
  ],
  "Needs Improvement": [
    "Your productivity has been reported to senior management. Please lower expectations for the rest of the team.",
    "Some numbers were fixed. Others were bravely left as they were.",
    "We appreciate your effort. The auditors will appreciate it less.",
  ],
  "Schedule a Meeting with HR": [
    "HR would like to schedule a quick sync about your “approach to numbers”.",
    "The spreadsheet has been forwarded to Legal for safekeeping.",
    "Bold strategy. The board meeting has been rescheduled indefinitely.",
  ],
};

export function managerFeedback(grade: PerformanceGrade, seed: string): string {
  const options = FEEDBACK[grade];
  return options[hashSeed(`${seed}:${grade}`) % options.length];
}

/**
 * Preview of Corporate XP this round might be worth once accounts exist.
 * Display only: nothing is saved and career progression is unchanged.
 */
export function previewCorporateXp(score: number): number {
  return Math.floor(Math.max(0, score) / 20);
}
