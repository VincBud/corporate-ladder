/**
 * Pipeline Panic scoring. Game points only; Corporate XP comes from the
 * score through the shared XP formula (1 XP per 20 points).
 *
 *   Correct decision       easy +80 · medium +100 · hard +130
 *   Revenue leakage        half the points (winning deal, bigger discount than needed)
 *   Bad deal               −50 (signed a deal that had to be rejected, or broke discount/margin policy)
 *   Prioritization error   −30 (closed a deal that had to wait)
 *   Missed opportunity     −45 (passed on, or under-priced, a deal that should have closed)
 *   Misfiled               −25 (disqualify vs. defer mixed up)
 *   Undecided              0
 *   Time bonus             up to +200, proportional to time left × accuracy, only when every
 *                          opportunity has a decision and at least 80% are correct
 *   Final score            never below 0
 *
 * Every round mixes all four correct actions, so repeating one action can't score well.
 */
import type { OutcomeKind, PipelineEvaluation } from "./evaluate";
import type { Difficulty, PipelineRound } from "./types";

export const PIPELINE_POINTS: Readonly<Record<Difficulty, number>> = { easy: 80, medium: 100, hard: 130 };
export const PIPELINE_PENALTIES: Readonly<Record<"badDeal" | "prioritization" | "missed" | "misfiled", number>> = {
  badDeal: 50,
  prioritization: 30,
  missed: 45,
  misfiled: 25,
};
export const PIPELINE_MAX_TIME_BONUS = 200;
export const TIME_BONUS_MIN_ACCURACY = 0.8;

const LABELS: Record<OutcomeKind, string> = {
  correct: "Correct decisions",
  leakage: "Revenue leakage (half points)",
  badDeal: "Bad deals",
  prioritization: "Prioritization errors",
  missed: "Missed opportunities",
  misfiled: "Misfiled leads",
  undecided: "No decision",
};

export interface PipelineScoreLine {
  label: string;
  count: number;
  points: number;
}

export interface PipelineScore {
  lines: PipelineScoreLine[];
  decisionPoints: number;
  /** Zero or negative. */
  penaltyPoints: number;
  timeBonus: number;
  total: number;
  maxPossible: number;
}

export function scorePipeline(
  round: Pick<PipelineRound, "scenarios">,
  evaluation: PipelineEvaluation,
  remainingMs: number,
  durationMs: number,
): PipelineScore {
  const points = (id: string) => PIPELINE_POINTS[round.scenarios[id].difficulty];
  const byKind = new Map<OutcomeKind, { count: number; points: number }>();
  let decisionPoints = 0;
  let penaltyPoints = 0;
  let maxPossible = PIPELINE_MAX_TIME_BONUS;

  for (const outcome of evaluation.outcomes) {
    maxPossible += points(outcome.id);
    let value = 0;
    if (outcome.kind === "correct") value = points(outcome.id);
    else if (outcome.kind === "leakage") value = Math.round(points(outcome.id) / 2);
    else if (outcome.kind !== "undecided") value = -PIPELINE_PENALTIES[outcome.kind];
    if (value > 0) decisionPoints += value;
    else penaltyPoints += value;
    const entry = byKind.get(outcome.kind) ?? { count: 0, points: 0 };
    byKind.set(outcome.kind, { count: entry.count + 1, points: entry.points + value });
  }

  const accuracy = evaluation.total > 0 ? evaluation.correctCount / evaluation.total : 0;
  const eligible = evaluation.undecidedCount === 0 && accuracy >= TIME_BONUS_MIN_ACCURACY;
  const ratio = durationMs > 0 ? Math.min(Math.max(remainingMs / durationMs, 0), 1) : 0;
  const timeBonus = eligible ? Math.round(PIPELINE_MAX_TIME_BONUS * ratio * accuracy) : 0;

  const order: OutcomeKind[] = ["correct", "leakage", "badDeal", "prioritization", "missed", "misfiled", "undecided"];
  const lines = order
    .filter((kind) => byKind.has(kind))
    .map((kind) => ({ label: LABELS[kind], count: byKind.get(kind)!.count, points: byKind.get(kind)!.points }));
  lines.push({ label: eligible ? "Time bonus" : "Time bonus (needs every decision made and 80% correct)", count: 0, points: timeBonus });

  return { lines, decisionPoints, penaltyPoints, timeBonus, total: Math.max(0, decisionPoints + penaltyPoints + timeBonus), maxPossible };
}

/** Points one outcome contributed (for the decision review). */
export function outcomePoints(round: Pick<PipelineRound, "scenarios">, outcome: { id: string; kind: OutcomeKind }): number {
  const points = PIPELINE_POINTS[round.scenarios[outcome.id].difficulty];
  if (outcome.kind === "correct") return points;
  if (outcome.kind === "leakage") return Math.round(points / 2);
  if (outcome.kind === "undecided") return 0;
  return -PIPELINE_PENALTIES[outcome.kind];
}
