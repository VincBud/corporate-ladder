/** Shared test helpers for progression tests. Not used by the app. */
import type { GameResultInput } from "@/types/progression";

export function resultInput(overrides: Partial<GameResultInput> = {}): GameResultInput {
  return {
    gameId: "reconciliation-rush",
    scoringVersion: 1,
    seed: "RR-TEST01",
    department: "Finance",
    difficulty: "associate",
    completedAt: "2026-10-30T10:00:00.000Z",
    completion: "submitted",
    score: 700,
    maxScore: 1000,
    grade: "Meets Expectations",
    errorsFixed: 4,
    totalErrors: 5,
    incorrectCorrections: 1,
    accuracy: 0.8,
    timeUsedMs: 60_000,
    timeRemainingMs: 30_000,
    assistanceUsed: false,
    ...overrides,
  };
}

/** Map-backed Storage that can be told to fail. */
export class FakeStorage {
  readonly items = new Map<string, string>();
  failReads = false;
  failWrites = false;
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.failReads) throw new Error("SecurityError");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  asStorage(): Storage {
    return this as unknown as Storage;
  }
}
