/**
 * DEMO DATA. Reproducible fictional employees and rounds for the simulation
 * preview. Nothing here is real activity, and none of it is ever sent to
 * the server.
 *
 * Each scenario is a set of parameters; the generator turns it into a
 * workforce, one round per event and quarterly market conditions, all from
 * a seeded RNG. A small share of rounds are deliberate seed replays and
 * duplicate submissions, so the preview shows the anti-farming rules at work.
 */
import { createRng, type Rng } from "@/games/spreadsheet-wars/reconciliation-rush/rng";
import { BRAND } from "@/config/brand";
import { DEPARTMENTS, STAFFING_PLAN, getMetric } from "../departments";
import type { QuarterConditions } from "../economy";
import { PREVIEW_GAME_RULES, type GameContributionRule } from "../games";
import { periodRange, periodStart } from "../periods";
import { simulateCompany, type SimulationResult } from "../simulate";
import { DEPARTMENT_IDS, type ContributionEvent, type DepartmentId, type PeriodId } from "../types";

export const DEMO_SCENARIO_IDS = [
  "baseline",
  "strong",
  "weak",
  "rapid-growth",
  "imbalance",
  "low-participation",
  "high-participation",
] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];

export interface DemoScenario {
  id: DemoScenarioId;
  label: string;
  description: string;
  /** Share of employees who play at all, first quarter → last quarter. */
  participation: [number, number];
  /** Rounds per active employee per quarter (inclusive range). */
  rounds: [number, number];
  /** Average skill, 0–1. */
  skill: number;
  assistedRate: number;
  timedOutRate: number;
  /** Chance a round is the employee's own department's game. */
  homeGameBias: number;
  /** Relative weights for the remaining rounds (default: by the headcount of each game's main department). */
  gameMix?: Readonly<Record<string, number>>;
  /** Base revenue growth per quarter. */
  marketGrowth: number;
  /** Headcount growth per quarter. */
  hiringRate: number;
  /** Cost index growth per quarter. */
  costInflation: number;
}

export const DEMO_FIRST_PERIOD: PeriodId = "2025-Q3";
export const DEMO_QUARTERS = 6;
export const DEMO_BASE_REVENUE = 16_000_000;
export const DEMO_BASE_HEADCOUNT: Readonly<Record<DepartmentId, number>> = STAFFING_PLAN;

/** The game each department's employees play most. */
const HOME_GAMES: Readonly<Record<DepartmentId, string>> = {
  finance: "expense-report-speedrun",
  controlling: "reconciliation-rush",
  people: "inbox-simulator",
  sales: "pipeline-panic",
  operations: "supply-chain-shuffle",
  it: "ticket-queue",
  marketing: "campaign-calendar",
};

const REPLAY_RATE = 0.04;
const DUPLICATE_RATE = 0.01;
const MAX_SCORE = 1050;
const OBJECTIVES = 5;

export const DEMO_SCENARIOS: Readonly<Record<DemoScenarioId, DemoScenario>> = {
  baseline: {
    id: "baseline",
    label: "Business as usual",
    description: "Moderate participation, competent work, a gently growing market.",
    participation: [0.42, 0.48],
    rounds: [1, 6],
    skill: 0.72,
    assistedRate: 0.2,
    timedOutRate: 0.1,
    homeGameBias: 0.6,
    marketGrowth: 0.015,
    hiringRate: 0.01,
    costInflation: 0.01,
  },
  strong: {
    id: "strong",
    label: "Strong performance",
    description: "High skill and steady engagement across every department.",
    participation: [0.55, 0.65],
    rounds: [2, 6],
    skill: 0.88,
    assistedRate: 0.1,
    timedOutRate: 0.04,
    homeGameBias: 0.6,
    marketGrowth: 0.025,
    hiringRate: 0.015,
    costInflation: 0.01,
  },
  weak: {
    id: "weak",
    label: "Weak performance",
    description: "Falling engagement, sloppy corrections and a shrinking market.",
    participation: [0.3, 0.2],
    rounds: [1, 4],
    skill: 0.48,
    assistedRate: 0.35,
    timedOutRate: 0.25,
    homeGameBias: 0.6,
    marketGrowth: -0.01,
    hiringRate: 0,
    costInflation: 0.015,
  },
  "rapid-growth": {
    id: "rapid-growth",
    label: "Rapid growth",
    description: "A booming market and aggressive hiring. Can output keep up with headcount?",
    participation: [0.5, 0.58],
    rounds: [1, 6],
    skill: 0.78,
    assistedRate: 0.15,
    timedOutRate: 0.08,
    homeGameBias: 0.6,
    marketGrowth: 0.07,
    hiringRate: 0.08,
    costInflation: 0.012,
  },
  imbalance: {
    id: "imbalance",
    label: "Department imbalance",
    description: "Everyone plays Reconciliation Rush. Controlling saturates; Sales and Marketing starve.",
    participation: [0.48, 0.5],
    rounds: [2, 6],
    skill: 0.78,
    assistedRate: 0.15,
    timedOutRate: 0.08,
    homeGameBias: 0.1,
    gameMix: { "reconciliation-rush": 12, "expense-report-speedrun": 2, "ticket-queue": 1 },
    marketGrowth: 0.015,
    hiringRate: 0.01,
    costInflation: 0.01,
  },
  "low-participation": {
    id: "low-participation",
    label: "Low participation",
    description: "A few dedicated grinders. Player caps stop them from carrying the company.",
    participation: [0.12, 0.08],
    rounds: [6, 12],
    skill: 0.85,
    assistedRate: 0.1,
    timedOutRate: 0.05,
    homeGameBias: 0.6,
    marketGrowth: 0.01,
    hiringRate: 0.01,
    costInflation: 0.01,
  },
  "high-participation": {
    id: "high-participation",
    label: "High participation",
    description: "Nearly everyone plays a round or two. Broad, casual engagement.",
    participation: [0.82, 0.92],
    rounds: [1, 3],
    skill: 0.7,
    assistedRate: 0.2,
    timedOutRate: 0.1,
    homeGameBias: 0.6,
    marketGrowth: 0.02,
    hiringRate: 0.01,
    costInflation: 0.01,
  },
};

export interface DemoEmployee {
  playerId: string;
  handle: string;
  departmentId: DepartmentId;
  skill: number;
  /** Index of the first quarter the employee is on payroll. */
  hiredInQuarter: number;
}

export interface DemoCompany {
  scenario: DemoScenario;
  seed: string;
  employees: DemoEmployee[];
  quarters: QuarterConditions[];
  events: ContributionEvent[];
}

const HANDLE_PREFIXES = ["pivot", "synergy", "ledger", "quarterly", "circle", "deck", "inbox", "agile", "cash", "audit", "vlookup", "margin", "kpi", "ping", "async", "budget"];
const HANDLE_NAMES = ["sam", "kim", "alex", "rio", "jo", "max", "pat", "lee", "noa", "kai", "ash", "val", "sky", "ren", "bo", "mo"];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

function headcountFor(scenario: DemoScenario, quarter: number): Record<DepartmentId, number> {
  return Object.fromEntries(
    DEPARTMENT_IDS.map((id) => [id, Math.round(DEMO_BASE_HEADCOUNT[id] * (1 + scenario.hiringRate) ** quarter)]),
  ) as Record<DepartmentId, number>;
}

/** Default mix weight: workforce of the department the game mostly feeds. */
function mainDepartmentHeadcount(rule: GameContributionRule): number {
  const [metricId] = Object.entries(rule.metricWeights).sort(([, a], [, b]) => b - a)[0];
  const metric = getMetric(metricId);
  return metric ? DEMO_BASE_HEADCOUNT[metric.departmentId] : 1;
}

function weightedPick(rng: Rng, weights: readonly [string, number][]): string {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [item, weight] of weights) {
    roll -= weight;
    if (roll < 0) return item;
  }
  return weights[weights.length - 1][0];
}

function playRound(rng: Rng, skill: number): Pick<ContributionEvent, "score" | "maxScore" | "objectivesCompleted" | "objectivesTotal" | "mistakes"> {
  let completed = 0;
  for (let i = 0; i < OBJECTIVES; i++) if (rng.chance(skill)) completed++;
  const mistakes = rng.chance(1 - skill) ? rng.int(1, 2) : 0;
  const timeBonus = completed === OBJECTIVES ? Math.round(300 * skill * rng.next()) : 0;
  const score = Math.min(MAX_SCORE, Math.max(0, completed * 150 - mistakes * 50 + timeBonus));
  return { score, maxScore: MAX_SCORE, objectivesCompleted: completed, objectivesTotal: OBJECTIVES, mistakes };
}

/** Builds the fictional company for a scenario. Same scenario and seed, same company. */
export function generateDemoCompany(scenarioId: DemoScenarioId, seed = "CSH-DEMO-1"): DemoCompany {
  const scenario = DEMO_SCENARIOS[scenarioId];
  const rng = createRng(`${scenarioId}:${seed}`);
  const periods = periodRange(DEMO_FIRST_PERIOD, DEMO_QUARTERS);
  const headcounts = periods.map((_, q) => headcountFor(scenario, q));

  // Roster: everyone who is employed in any quarter. Department employee i is hired once headcount exceeds i.
  const employees: DemoEmployee[] = [];
  for (const department of DEPARTMENTS) {
    const finalHeads = headcounts[headcounts.length - 1][department.id];
    for (let i = 0; i < finalHeads; i++) {
      const hiredInQuarter = headcounts.findIndex((h) => h[department.id] > i);
      employees.push({
        playerId: `demo-${department.representation.shortName.toLowerCase()}-${String(i + 1).padStart(3, "0")}`,
        handle: `${rng.pick(HANDLE_PREFIXES)}_${rng.pick(HANDLE_NAMES)}${rng.int(1, 99)}`,
        departmentId: department.id,
        skill: clamp01(scenario.skill + (rng.next() - 0.5) * 0.3),
        hiredInQuarter: Math.max(0, hiredInQuarter),
      });
    }
  }

  const mixRules = PREVIEW_GAME_RULES.filter((rule) => !scenario.gameMix || rule.gameId in scenario.gameMix);
  const mix: [string, number][] = mixRules.map((rule) => [rule.gameId, scenario.gameMix?.[rule.gameId] ?? mainDepartmentHeadcount(rule)]);
  const ruleById = new Map(PREVIEW_GAME_RULES.map((rule) => [rule.gameId, rule]));
  const seedsPlayed = new Map<string, string[]>();
  const events: ContributionEvent[] = [];

  periods.forEach((period, q) => {
    const participation = lerp(scenario.participation[0], scenario.participation[1], periods.length > 1 ? q / (periods.length - 1) : 0);
    const start = periodStart(period);
    for (const employee of employees) {
      if (employee.hiredInQuarter > q || !rng.chance(participation)) continue;
      const rounds = rng.int(scenario.rounds[0], scenario.rounds[1]);
      for (let r = 0; r < rounds; r++) {
        const gameId = rng.chance(scenario.homeGameBias) ? HOME_GAMES[employee.departmentId] : weightedPick(rng, mix);
        const rule = ruleById.get(gameId)!;
        const seedHistoryKey = `${employee.playerId}:${gameId}`;
        const history = seedsPlayed.get(seedHistoryKey) ?? [];
        const seedValue =
          history.length > 0 && rng.chance(REPLAY_RATE) ? rng.pick(history) : `demo-${scenarioId}-${period}-${employee.playerId}-${r}`;
        seedsPlayed.set(seedHistoryKey, [...history, seedValue]);

        const event: ContributionEvent = {
          eventId: `demo:${scenarioId}:${seed}:${employee.playerId}:${period}:${r}`,
          playerId: employee.playerId,
          gameId,
          scoringVersion: 1,
          difficulty: rule.status === "live" ? "associate" : rng.chance(0.25) ? "senior" : "associate",
          seed: seedValue,
          completedAt: new Date(start + rng.int(0, 89 * 24 * 60 - 1) * 60_000).toISOString(),
          ...playRound(rng, employee.skill),
          completion: rng.chance(scenario.timedOutRate) ? "timedOut" : "submitted",
          assisted: rng.chance(scenario.assistedRate),
          provenance: "demo",
        };
        events.push(event);
        if (rng.chance(DUPLICATE_RATE)) events.push({ ...event });
      }
    }
  });

  const quarters: QuarterConditions[] = periods.map((periodId, q) => ({
    periodId,
    headcount: headcounts[q],
    baseRevenue: Math.round(DEMO_BASE_REVENUE * (1 + scenario.marketGrowth) ** q),
    costIndex: (1 + scenario.costInflation) ** q,
  }));

  return { scenario, seed, employees, quarters, events };
}

export interface DemoSimulation extends SimulationResult {
  company: DemoCompany;
}

/** Generates a scenario and runs it through the engine in preview mode. */
export function runDemoSimulation(scenarioId: DemoScenarioId, seed?: string): DemoSimulation {
  const company = generateDemoCompany(scenarioId, seed);
  const result = simulateCompany({
    companyId: `demo:${scenarioId}:${company.seed}`,
    companyName: BRAND.company,
    provenance: "demo",
    rules: PREVIEW_GAME_RULES,
    quarters: company.quarters,
    events: company.events,
  });
  return { ...result, company };
}
