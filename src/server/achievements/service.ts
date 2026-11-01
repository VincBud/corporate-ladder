import "server-only";
/**
 * Server-authoritative achievements. Reads the player's authoritative facts,
 * evaluates the registry and awards whatever is newly earned. Idempotent:
 * the database keeps one row per player and achievement and returns only
 * rows it actually created, so retries and concurrent calls never duplicate
 * an unlock (or its toast).
 *
 * Called after verified submissions and department changes, and on every
 * career load. The career load doubles as the backfill and recovery path:
 * history earned before achievements existed, or an award that failed after
 * a submission, is picked up the next time the player's career loads.
 */
import { evaluateAchievements, isAchievementId, type AchievementFacts } from "@/career/achievements";
import { parseDbTimestamp } from "@/career/department-membership";
import type { AchievementSummary, AchievementUnlock } from "@/types/achievements";
import type { ResultRow, RpcCall } from "../rounds/round-store";
import { resultRowToRecord } from "../rounds/service";

interface FactsPayload {
  results: Omit<ResultRow, "submission">[];
  memberships: { id: string; department_id: string; started_at: string; ended_at: string | null; start_reason: "initial" | "transfer" | "legacy" }[];
  contributions: { session_id: string; period_id: string; completed_at: string }[];
  unlocked: { achievement_id: string; unlocked_at: string }[];
}

const toUnlocks = (rows: { achievement_id: string; unlocked_at: string }[]): AchievementUnlock[] =>
  rows.filter((r) => isAchievementId(r.achievement_id)).map((r) => ({ id: r.achievement_id as AchievementUnlock["id"], unlockedAt: parseDbTimestamp(r.unlocked_at) }));

export function factsFromPayload(payload: FactsPayload): AchievementFacts {
  return {
    results: payload.results.map((row) => resultRowToRecord({ ...row, submission: {} })),
    memberships: payload.memberships.map((m) => ({
      id: m.id,
      departmentId: m.department_id,
      startedAt: parseDbTimestamp(m.started_at),
      endedAt: m.ended_at === null ? null : parseDbTimestamp(m.ended_at),
      startReason: m.start_reason,
    })),
    contributions: payload.contributions.map((c) => ({ sessionId: c.session_id, periodId: c.period_id, completedAt: parseDbTimestamp(c.completed_at) })),
  };
}

export interface AchievementSync {
  summary: AchievementSummary;
  /** Unlocks created by this call (for the toast). Empty on retries. */
  created: AchievementUnlock[];
}

export async function syncAchievements(rpc: RpcCall, userId: string): Promise<AchievementSync> {
  const payload = (await rpc("get_achievement_facts", { p_user_id: userId })) as FactsPayload;
  const evaluations = evaluateAchievements(factsFromPayload(payload));
  const existing = new Set(payload.unlocked.map((u) => u.achievement_id));
  const awards = evaluations
    .filter((e) => e.unlocked && !existing.has(e.id))
    .map((e) => ({ achievement_id: e.id, achieved_at: e.achievedAt, source_type: e.source?.type ?? null, source_id: e.source?.id ?? null }));

  let unlocked = toUnlocks(payload.unlocked);
  let created: AchievementUnlock[] = [];
  if (awards.length > 0) {
    const result = (await rpc("award_achievements", { p_user_id: userId, p_awards: awards })) as {
      created: { achievement_id: string; unlocked_at: string }[];
      unlocked: { achievement_id: string; unlocked_at: string }[];
    };
    created = toUnlocks(result.created);
    unlocked = toUnlocks(result.unlocked);
  }
  const progress: AchievementSummary["progress"] = {};
  for (const e of evaluations) if (e.progress) progress[e.id] = e.progress;
  return { summary: { unlocked, progress }, created };
}

/** For request paths where achievements must never fail the main action. */
export async function syncAchievementsSafely(rpc: RpcCall | null, userId: string): Promise<AchievementSync | null> {
  if (!rpc) return null;
  try {
    return await syncAchievements(rpc, userId);
  } catch (error) {
    console.error("[achievements] sync failed; it will be retried on the next career load", error);
    return null;
  }
}
