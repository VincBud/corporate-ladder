/** Task Performance Report helpers for Pipeline Panic. A single round is never a Quarterly Performance Review. */
import { hashSeed } from "@/games/spreadsheet-wars/reconciliation-rush/rng";
import type { PerformanceGrade } from "@/games/spreadsheet-wars/reconciliation-rush/report";
import type { PipelineEvaluation } from "./evaluate";

export function gradePipeline(evaluation: PipelineEvaluation): PerformanceGrade {
  const accuracy = evaluation.total ? evaluation.correctCount / evaluation.total : 0;
  const badDeals = evaluation.outcomes.some((o) => o.kind === "badDeal");
  if (evaluation.undecidedCount === 0 && accuracy >= 0.9 && !badDeals) return "Exceeds Expectations";
  if (accuracy >= 0.7) return "Meets Expectations";
  if (accuracy >= 0.4) return "Needs Improvement";
  return "Schedule a Meeting with HR";
}

/** Share of decided opportunities that were fully correct; null when nothing was decided. */
export function decisionAccuracy(evaluation: PipelineEvaluation): number | null {
  const decided = evaluation.total - evaluation.undecidedCount;
  return decided === 0 ? null : evaluation.correctCount / decided;
}

const FEEDBACK: Record<PerformanceGrade, readonly string[]> = {
  "Exceeds Expectations": [
    "Quota crushed. The VP of Sales will now take full credit at the kickoff.",
    "Flawless pipeline hygiene. We're printing your face on a motivational poster.",
    "Outstanding. Your reward is a higher quota next quarter.",
  ],
  "Meets Expectations": [
    "Solid quarter. The forecast was only slightly fictional.",
    "Good work. Your manager forwarded it with \"see below\" and nothing else.",
    "Meets expectations. The commission check is in the mail, metaphorically.",
  ],
  "Needs Improvement": [
    "Some deals closed. Others were closed in a more spiritual sense.",
    "Legal would like a word about a few of those signatures.",
    "Promising. Please attend the mandatory 4-hour pipeline workshop.",
  ],
  "Schedule a Meeting with HR": [
    "Finance has frozen your expense card as a precaution.",
    "The CRM has filed a complaint about you.",
    "Bold strategy. The board has asked to see your pipeline \"in person\".",
  ],
};

export function pipelineFeedback(grade: PerformanceGrade, seed: string): string {
  const options = FEEDBACK[grade];
  return options[hashSeed(`pipeline:${seed}:${grade}`) % options.length];
}
