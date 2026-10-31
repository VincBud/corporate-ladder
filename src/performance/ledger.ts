/**
 * Applies finished rounds to a career save. Pure and idempotent: the session
 * id is the record id, so recording the same round twice changes nothing.
 */
import { describeProgressChange, type ProgressChange } from "@/career/progression";
import { calculateXpAward, type XpAward } from "@/career/xp";
import type { GameResultInput, GameResultRecord } from "@/types/progression";
import type { CareerSave } from "./schema";

export function earnedXp(records: readonly GameResultRecord[]): number {
  return records.reduce((total, record) => total + record.xpAwarded, 0);
}

export interface RecordedResult {
  save: CareerSave;
  record: GameResultRecord;
  /** True when this session was already recorded; nothing was added. */
  duplicate: boolean;
  /** XP decision for a new record; null for duplicates. */
  award: XpAward | null;
  change: ProgressChange;
}

/**
 * @param baselineXp XP the player had before any locally recorded rounds
 *   (the employee's starting XP). Used to detect promotions.
 */
export function addResult(save: CareerSave, sessionId: string, input: GameResultInput, baselineXp = 0): RecordedResult {
  const xpBefore = baselineXp + earnedXp(save.records);
  const existing = save.records.find((record) => record.id === sessionId);
  if (existing) {
    return { save, record: existing, duplicate: true, award: null, change: describeProgressChange(xpBefore, xpBefore) };
  }

  const award = calculateXpAward(input, save.records);
  const record: GameResultRecord = { ...input, id: sessionId, xpAwarded: award.xp };
  return {
    save: { ...save, records: [...save.records, record] },
    record,
    duplicate: false,
    award,
    change: describeProgressChange(xpBefore, xpBefore + award.xp),
  };
}
