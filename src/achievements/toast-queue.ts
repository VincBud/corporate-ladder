/**
 * Achievement toasts waiting to be shown. Only unlocks the server just
 * created are queued, so a refresh or retried request never repeats one;
 * each id is also shown at most once per page session.
 */
import { useSyncExternalStore } from "react";
import type { AchievementUnlock } from "@/types/achievements";

let queue: AchievementUnlock[] = [];
const shown = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function enqueueAchievementToasts(unlocks: readonly AchievementUnlock[] | null | undefined): void {
  const fresh = (unlocks ?? []).filter((u) => !shown.has(u.id) && !queue.some((q) => q.id === u.id));
  if (fresh.length === 0) return;
  queue = [...queue, ...fresh];
  emit();
}

export function dismissAchievementToast(): void {
  const [first, ...rest] = queue;
  if (!first) return;
  shown.add(first.id);
  queue = rest;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The toast to show now, or null. */
export const currentAchievementToast = (): AchievementUnlock | null => queue[0] ?? null;

export function useNextAchievementToast(): AchievementUnlock | null {
  return useSyncExternalStore(subscribe, currentAchievementToast, () => null);
}

/** Test helper. */
export function resetAchievementToasts(): void {
  queue = [];
  shown.clear();
  emit();
}
