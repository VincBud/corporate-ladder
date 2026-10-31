import type { CareerSnapshot, LevelProgress, Rank } from "@/types/career";
import { RANKS } from "./ranks";

export const MAX_LEVEL = 60;

/** XP curve: reaching level L requires 50 · L · (L − 1) total XP. */
const XP_STEP = 50;

export function totalXpForLevel(level: number): number {
  const clamped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return XP_STEP * clamped * (clamped - 1);
}

export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  let level = Math.floor((1 + Math.sqrt(1 + (4 * xp) / XP_STEP)) / 2);
  level = Math.min(Math.max(level, 1), MAX_LEVEL);
  // Guard against floating-point drift at exact level boundaries.
  while (level < MAX_LEVEL && totalXpForLevel(level + 1) <= xp) level++;
  while (level > 1 && totalXpForLevel(level) > xp) level--;
  return level;
}

export function getLevelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const isMaxLevel = level >= MAX_LEVEL;
  const levelStartXp = totalXpForLevel(level);
  const nextLevelXp = isMaxLevel ? levelStartXp : totalXpForLevel(level + 1);
  const span = nextLevelXp - levelStartXp;

  return {
    xp,
    level,
    levelStartXp,
    nextLevelXp,
    xpIntoLevel: xp - levelStartXp,
    xpToNextLevel: Math.max(0, nextLevelXp - xp),
    ratio: isMaxLevel || span === 0 ? 1 : (xp - levelStartXp) / span,
    isMaxLevel,
  };
}

export function rankForLevel(level: number): Rank {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (level >= rank.minLevel) current = rank;
  }
  return current;
}

export function nextRankAfter(rank: Rank): Rank | null {
  const index = RANKS.findIndex((candidate) => candidate.id === rank.id);
  return RANKS[index + 1] ?? null;
}

export function getCareerSnapshot(xp: number): CareerSnapshot {
  const progress = getLevelProgress(xp);
  const rank = rankForLevel(progress.level);
  const nextRank = nextRankAfter(rank);

  return {
    progress,
    rank,
    nextRank,
    xpToNextRank: nextRank ? Math.max(0, totalXpForLevel(nextRank.minLevel) - xp) : 0,
  };
}

export interface ProgressChange {
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  rankBefore: Rank;
  rankAfter: Rank;
  leveledUp: boolean;
  /** True when the rank changed (a promotion), not just the level. */
  promoted: boolean;
}

export function describeProgressChange(xpBefore: number, xpAfter: number): ProgressChange {
  const before = getCareerSnapshot(xpBefore);
  const after = getCareerSnapshot(xpAfter);
  return {
    xpBefore,
    xpAfter,
    levelBefore: before.progress.level,
    levelAfter: after.progress.level,
    rankBefore: before.rank,
    rankAfter: after.rank,
    leveledUp: after.progress.level > before.progress.level,
    promoted: after.rank.id !== before.rank.id && after.rank.minLevel > before.rank.minLevel,
  };
}
