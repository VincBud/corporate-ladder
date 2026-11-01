/**
 * Achievements: a typed registry and a pure evaluator.
 *
 * Achievements are derived from authoritative facts only: the server's
 * verified game results, department membership history, department
 * promotions (the department career policy in department-tracks.ts) and
 * verified company contribution events. The server evaluates them and
 * stores unlocks once (supabase/migrations/…_achievements.sql); clients
 * never decide or submit unlocks.
 *
 * Adding an achievement: add it here and seed its id in a migration
 * (a test checks both match). "future" achievements are shown as coming
 * later and can't be unlocked until the mechanic exists.
 */
import { DEPARTMENT_PROGRESSION, progressionGames, type MembershipPeriod } from "@/career/department-tracks";
import { isCanonicalDepartmentId } from "@/config/departments";
import type { GameResultRecord } from "@/types/progression";

export const ACHIEVEMENT_CATEGORIES = ["gameplay", "career", "department", "company"] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_RARITIES = ["common", "uncommon", "rare", "epic"] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

/** Icon keys; the UI maps them to LadderOS icons. */
export type AchievementIcon = "badge" | "check" | "sparkle" | "clock" | "grid" | "funnel" | "ladder" | "briefcase" | "building" | "trophy";

/** Future sources the data model is ready for (no mechanics yet). */
export type FutureAchievementSource = "dailyChallenge" | "weeklyChallenge" | "quarterlyReview" | "communityMilestone" | "specialEvent";

export const ACHIEVEMENT_IDS = [
  "first-assignment",
  "clean-audit",
  "deal-maker",
  "sales-excellence",
  "no-assistance-required",
  "ahead-of-schedule",
  "cross-functional",
  "welcome-aboard",
  "climbing-the-ladder",
  "middle-management",
  "getting-started",
  "corporate-veteran",
  "reconciliation-specialist",
  "quota-crusher",
  "internal-mobility",
  "team-player",
  "quarterly-contributor",
  "perfect-quarter",
  "daily-grind",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export interface AchievementDefinition {
  id: AchievementId;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  rarity: AchievementRarity;
  order: number;
  /** "future": the mechanic doesn't exist yet; shown locked and never unlocked. */
  status: "available" | "future";
  /** For future achievements: what will make them possible. */
  futureSource?: FutureAchievementSource;
  /** Progress target for counting achievements. */
  target?: number;
}

const def = (d: AchievementDefinition) => d;

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  def({ id: "first-assignment", name: "First Assignment", description: "Complete your first verified round. The onboarding deck said it would be easy.", category: "gameplay", icon: "badge", rarity: "common", order: 1, status: "available" }),
  def({ id: "clean-audit", name: "Clean Audit", description: "Fix all five discrepancies in a verified Reconciliation Rush round.", category: "gameplay", icon: "grid", rarity: "uncommon", order: 2, status: "available" }),
  def({ id: "deal-maker", name: "Deal Maker", description: "Make five correct decisions in one verified Pipeline Panic round.", category: "gameplay", icon: "funnel", rarity: "common", order: 3, status: "available" }),
  def({ id: "sales-excellence", name: "Sales Excellence", description: "Get every decision right in a verified Pipeline Panic round.", category: "gameplay", icon: "trophy", rarity: "rare", order: 4, status: "available" }),
  def({ id: "no-assistance-required", name: "No Assistance Required", description: "A perfect verified round without Request Assistance. Your manager will take the credit.", category: "gameplay", icon: "sparkle", rarity: "rare", order: 5, status: "available" }),
  def({ id: "ahead-of-schedule", name: "Ahead of Schedule", description: "A perfect verified round with at least half the clock left.", category: "gameplay", icon: "clock", rarity: "epic", order: 6, status: "available" }),
  def({ id: "cross-functional", name: "Cross-Functional", description: "Complete verified rounds in two different games.", category: "gameplay", icon: "check", rarity: "uncommon", order: 7, status: "available", target: 2 }),
  def({ id: "welcome-aboard", name: "Welcome Aboard", description: "Join your first department. Badge photo not included.", category: "career", icon: "briefcase", rarity: "common", order: 10, status: "available" }),
  def({ id: "climbing-the-ladder", name: "Climbing the Ladder", description: "Earn your first department promotion.", category: "career", icon: "ladder", rarity: "uncommon", order: 11, status: "available", target: DEPARTMENT_PROGRESSION.roundsForTier[1] }),
  def({ id: "middle-management", name: "Middle Management", description: "Reach the second promotion in a department's career track.", category: "career", icon: "ladder", rarity: "rare", order: 12, status: "available", target: DEPARTMENT_PROGRESSION.roundsForTier[2] }),
  def({ id: "getting-started", name: "Getting Started", description: "Complete 10 verified rounds.", category: "career", icon: "check", rarity: "common", order: 13, status: "available", target: 10 }),
  def({ id: "corporate-veteran", name: "Corporate Veteran", description: "Complete 50 verified rounds. You've seen things.", category: "career", icon: "trophy", rarity: "epic", order: 14, status: "available", target: 50 }),
  def({ id: "reconciliation-specialist", name: "Reconciliation Specialist", description: "Five qualifying verified Reconciliation Rush rounds (at least 4 of 5 fixed, in time).", category: "department", icon: "grid", rarity: "uncommon", order: 20, status: "available", target: 5 }),
  def({ id: "quota-crusher", name: "Quota Crusher", description: "Five qualifying verified Pipeline Panic rounds (at least 80% correct, in time).", category: "department", icon: "funnel", rarity: "uncommon", order: 21, status: "available", target: 5 }),
  def({ id: "internal-mobility", name: "Internal Mobility", description: "Transfer to another department. The farewell cake was store-bought.", category: "department", icon: "briefcase", rarity: "uncommon", order: 22, status: "available" }),
  def({ id: "team-player", name: "Team Player", description: "Make your first verified contribution to the company.", category: "company", icon: "building", rarity: "common", order: 30, status: "available" }),
  def({ id: "quarterly-contributor", name: "Quarterly Contributor", description: "Contribute to the company in two different quarters.", category: "company", icon: "building", rarity: "rare", order: 31, status: "available", target: 2 }),
  def({ id: "perfect-quarter", name: "Perfect Quarter", description: "Receive a top rating in a Quarterly Performance Review.", category: "career", icon: "sparkle", rarity: "epic", order: 15, status: "future", futureSource: "quarterlyReview" }),
  def({ id: "daily-grind", name: "Daily Grind", description: "Complete a ranked Daily Challenge before its timer runs out.", category: "gameplay", icon: "clock", rarity: "common", order: 8, status: "available" }),
].sort((a, b) => a.order - b.order);

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const getAchievement = (id: AchievementId) => BY_ID.get(id)!;
export const isAchievementId = (value: unknown): value is AchievementId => typeof value === "string" && BY_ID.has(value as AchievementId);

/** Authoritative facts for one player (built by the server). */
export interface AchievementFacts {
  /** Verified results (seed replaced by an opaque reference). */
  results: readonly GameResultRecord[];
  memberships: readonly (MembershipPeriod & { id: string; startReason: "initial" | "transfer" | "legacy" })[];
  contributions: readonly { sessionId: string; periodId: string; completedAt: string }[];
  /** Official results of ranked Daily Challenge attempts (from daily_challenge_attempts). */
  dailies: readonly { sessionId: string; challengeId: string; challengeDate: string; completion: "submitted" | "timedOut"; completedAt: string }[];
}

export type AchievementSource = { type: "game_result" | "department_membership" | "contribution_event"; id: string } | null;

export interface AchievementEvaluation {
  id: AchievementId;
  unlocked: boolean;
  /** When the condition was first met (from the facts), if unlocked. */
  achievedAt: string | null;
  source: AchievementSource;
  /** Counting achievements only. */
  progress: { current: number; target: number } | null;
}

const isPerfect = (r: GameResultRecord) => r.totalErrors > 0 && r.errorsFixed === r.totalErrors && r.incorrectCorrections === 0 && r.completion === "submitted";
const isQualifying = (r: GameResultRecord) =>
  r.completion === "submitted" && r.totalErrors > 0 && r.errorsFixed / r.totalErrors >= DEPARTMENT_PROGRESSION.qualifyingResolution;

/** The k-th fact (1-based) of a chronological list, as the unlock moment. */
function nth<T>(items: readonly T[], k: number, at: (item: T) => string): T | null {
  const sorted = [...items].sort((a, b) => at(a).localeCompare(at(b)));
  return sorted[k - 1] ?? null;
}

function distinctBySeed(results: readonly GameResultRecord[]): GameResultRecord[] {
  const seen = new Set<string>();
  return [...results]
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .filter((r) => {
      const key = `${r.gameId}:${r.seed}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Evaluates every achievement from the facts. Pure and deterministic. */
export function evaluateAchievements(facts: AchievementFacts): AchievementEvaluation[] {
  const results = [...facts.results].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  const byTime = (r: GameResultRecord) => r.completedAt;
  const fromResult = (r: GameResultRecord | null | undefined): Pick<AchievementEvaluation, "unlocked" | "achievedAt" | "source"> =>
    r ? { unlocked: true, achievedAt: r.completedAt, source: { type: "game_result", id: r.id } } : { unlocked: false, achievedAt: null, source: null };
  const counting = (items: readonly GameResultRecord[], target: number) => ({
    ...fromResult(nth(items, target, byTime)),
    progress: { current: Math.min(items.length, target), target },
  });

  /**
   * Promotions follow the department career policy: tier k is reached with the
   * roundsForTier[k]-th qualifying round (distinct puzzle, in a game that feeds
   * the department, completed while a member). The unlock round is the
   * earliest such round across departments.
   */
  const departments = [...new Set(facts.memberships.map((m) => m.departmentId))].filter(isCanonicalDepartmentId);
  const qualifyingIn = (departmentId: string) => {
    const games = new Set(progressionGames(departmentId).map((g) => g.gameId));
    const periods = facts.memberships
      .filter((m) => m.departmentId === departmentId)
      .map((m) => [Date.parse(m.startedAt), m.endedAt ? Date.parse(m.endedAt) : Infinity] as const);
    return distinctBySeed(
      results.filter((r) => {
        const at = Date.parse(r.completedAt);
        return games.has(r.gameId) && isQualifying(r) && periods.some(([start, end]) => at >= start && at < end);
      }),
    );
  };
  const promotionAt = (tier: number): GameResultRecord | null => {
    let earliest: GameResultRecord | null = null;
    for (const d of departments) {
      const round = qualifyingIn(d)[DEPARTMENT_PROGRESSION.roundsForTier[tier] - 1];
      if (round && (!earliest || round.completedAt < earliest.completedAt)) earliest = round;
    }
    return earliest;
  };
  const bestQualifyingInDepartment = () => Math.max(0, ...departments.map((d) => qualifyingIn(d).length));

  const games = new Map<string, GameResultRecord>();
  for (const r of results) if (!games.has(r.gameId)) games.set(r.gameId, r);
  const firstMembership = [...facts.memberships].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  const firstTransfer = [...facts.memberships].filter((m) => m.startReason === "transfer").sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  const contributions = [...facts.contributions].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const quarters: typeof contributions = [];
  for (const c of contributions) if (!quarters.some((q) => q.periodId === c.periodId)) quarters.push(c);
  const membershipSource = (m: (typeof facts.memberships)[number] | undefined) =>
    m ? { unlocked: true, achievedAt: m.startedAt, source: { type: "department_membership" as const, id: m.id } } : { unlocked: false, achievedAt: null, source: null };
  const contributionSource = (c: (typeof contributions)[number] | undefined) =>
    c ? { unlocked: true, achievedAt: c.completedAt, source: { type: "contribution_event" as const, id: c.sessionId } } : { unlocked: false, achievedAt: null, source: null };
  const rounds = (target: number) => counting(results, target);
  const qualifying = (gameId: string, target: number) => counting(distinctBySeed(results.filter((r) => r.gameId === gameId && isQualifying(r))), target);

  const evaluators: Record<AchievementId, () => Omit<AchievementEvaluation, "id">> = {
    "first-assignment": () => ({ ...fromResult(results[0]), progress: null }),
    "clean-audit": () => ({ ...fromResult(results.find((r) => r.gameId === "reconciliation-rush" && r.totalErrors > 0 && r.errorsFixed === r.totalErrors)), progress: null }),
    "deal-maker": () => ({ ...fromResult(results.find((r) => r.gameId === "pipeline-panic" && r.errorsFixed >= 5)), progress: null }),
    "sales-excellence": () => ({ ...fromResult(results.find((r) => r.gameId === "pipeline-panic" && isPerfect(r))), progress: null }),
    "no-assistance-required": () => ({ ...fromResult(results.find((r) => isPerfect(r) && !r.assistanceUsed)), progress: null }),
    "ahead-of-schedule": () => ({
      ...fromResult(results.find((r) => isPerfect(r) && r.timeRemainingMs * 2 >= r.timeUsedMs + r.timeRemainingMs)),
      progress: null,
    }),
    "cross-functional": () => {
      const firsts = [...games.values()];
      return { ...fromResult(nth(firsts, 2, byTime)), progress: { current: Math.min(firsts.length, 2), target: 2 } };
    },
    "welcome-aboard": () => ({ ...membershipSource(firstMembership), progress: null }),
    "climbing-the-ladder": () => ({ ...fromResult(promotionAt(1)), progress: { current: Math.min(bestQualifyingInDepartment(), DEPARTMENT_PROGRESSION.roundsForTier[1]), target: DEPARTMENT_PROGRESSION.roundsForTier[1] } }),
    "middle-management": () => ({ ...fromResult(promotionAt(2)), progress: { current: Math.min(bestQualifyingInDepartment(), DEPARTMENT_PROGRESSION.roundsForTier[2]), target: DEPARTMENT_PROGRESSION.roundsForTier[2] } }),
    "getting-started": () => rounds(10),
    "corporate-veteran": () => rounds(50),
    "reconciliation-specialist": () => qualifying("reconciliation-rush", 5),
    "quota-crusher": () => qualifying("pipeline-panic", 5),
    "internal-mobility": () => ({ ...membershipSource(firstTransfer), progress: null }),
    "team-player": () => ({ ...contributionSource(contributions[0]), progress: null }),
    "quarterly-contributor": () => ({ ...contributionSource(quarters[1]), progress: { current: Math.min(quarters.length, 2), target: 2 } }),
    "perfect-quarter": () => ({ unlocked: false, achievedAt: null, source: null, progress: null }),
    "daily-grind": () => {
      const first = nth(facts.dailies.filter((d) => d.completion === "submitted"), 1, (d) => d.completedAt);
      return first
        ? { unlocked: true, achievedAt: first.completedAt, source: { type: "game_result", id: first.sessionId }, progress: null }
        : { unlocked: false, achievedAt: null, source: null, progress: null };
    },
  };

  return ACHIEVEMENTS.map((a) => {
    const result = evaluators[a.id]();
    return a.status === "future" ? { id: a.id, unlocked: false, achievedAt: null, source: null, progress: null } : { id: a.id, ...result };
  });
}
