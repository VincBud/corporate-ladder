/**
 * Which operational metrics each minigame feeds, and how strongly.
 *
 * Adding a minigame: add a rule here. Attribution follows the kind of work
 * the game exercises, never the fictional business in the puzzle. A
 * Reconciliation Rush ledger themed "Marketing" is still reconciliation work,
 * so it feeds Controlling and Finance, not Marketing.
 */
import type { GameplayCategory } from "./types";

export interface GameContributionRule {
  gameId: string;
  title: string;
  /** Planned games exist only in the simulation preview. */
  status: "live" | "planned";
  /**
   * Version of this game's contribution formula: the metric shares below and
   * the normalization in contribution.ts. Live games must match the active
   * row in public.contribution_formulas; bump both together.
   */
  formulaVersion: number;
  category: GameplayCategory;
  /** Scoring versions whose results can be normalized. Others are rejected. */
  scoringVersions: readonly number[];
  /** Multiplier per difficulty. Unknown difficulties are rejected. */
  difficultyWeights: Readonly<Record<string, number>>;
  /** Metric id → share of the event's points. Shares sum to 1. */
  metricWeights: Readonly<Record<string, number>>;
}

export const RECONCILIATION_RUSH_RULE: GameContributionRule = {
  gameId: "reconciliation-rush",
  title: "Reconciliation Rush",
  status: "live",
  formulaVersion: 1,
  category: "reconciliation",
  scoringVersions: [1],
  difficultyWeights: { associate: 1 },
  metricWeights: { "ledger-integrity": 0.7, "close-quality": 0.3 },
};

const plannedRule = (
  gameId: string,
  title: string,
  category: GameplayCategory,
  metricWeights: Record<string, number>,
): GameContributionRule => ({
  gameId,
  title,
  status: "planned",
  formulaVersion: 1,
  category,
  scoringVersions: [1],
  difficultyWeights: { associate: 1, senior: 1.25 },
  metricWeights,
});

/** Fictional future minigames used to populate the preview. Not playable. */
export const PLANNED_GAME_RULES: readonly GameContributionRule[] = [
  plannedRule("expense-report-speedrun", "Expense Report Speedrun", "expense-control", { "close-quality": 0.7, "ledger-integrity": 0.3 }),
  plannedRule("inbox-simulator", "Inbox Simulator", "people-operations", { "people-operations": 0.7, "campaign-effectiveness": 0.3 }),
  plannedRule("meeting-bingo", "Meeting Bingo", "communication", { "pipeline-health": 0.6, "people-operations": 0.4 }),
  plannedRule("pipeline-triage", "Pipeline Triage", "negotiation", { "pipeline-health": 0.8, "campaign-effectiveness": 0.2 }),
  plannedRule("supply-chain-shuffle", "Supply Chain Shuffle", "logistics", { "fulfilment-reliability": 0.8, "close-quality": 0.2 }),
  plannedRule("ticket-queue", "Ticket Queue", "troubleshooting", { "service-reliability": 0.8, "fulfilment-reliability": 0.2 }),
  plannedRule("campaign-calendar", "Campaign Calendar", "campaign-planning", { "campaign-effectiveness": 0.8, "pipeline-health": 0.2 }),
];

/** Games whose verified results can count toward the real company. */
export const LIVE_GAME_RULES: readonly GameContributionRule[] = [RECONCILIATION_RUSH_RULE];

/** Live games plus planned ones, for the preview only. */
export const PREVIEW_GAME_RULES: readonly GameContributionRule[] = [...LIVE_GAME_RULES, ...PLANNED_GAME_RULES];
