/**
 * Employee Orientation: the three-screen welcome shown once per browser.
 *
 * Completion or dismissal is remembered per device (not per account), so a
 * guest who finishes it and then signs up or signs in isn't shown it again.
 * It only opens by itself for players without prior progress, so existing
 * employees aren't interrupted after an update, and never over a running
 * round. It can always be reopened from the launcher.
 */
import { useSyncExternalStore } from "react";

export const ORIENTATION_STORAGE_KEY = "corporate-ladder.orientation.v1";
const CHANGE_EVENT = "corporate-ladder:orientation";

export type OrientationOutcome = "completed" | "dismissed";
export interface OrientationRecord {
  outcome: OrientationOutcome;
  at: string;
}

/**
 * What this browser remembers. `available: false` means storage is blocked;
 * the orientation then never opens by itself (it couldn't remember being
 * dismissed and would reappear on every visit).
 */
export type OrientationMemory = { available: true; record: OrientationRecord | null } | { available: false };

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function readOrientation(storage: ReadableStorage | null): OrientationMemory {
  if (!storage) return { available: false };
  try {
    const raw = storage.getItem(ORIENTATION_STORAGE_KEY);
    if (raw === null) return { available: true, record: null };
    const parsed = JSON.parse(raw) as Partial<OrientationRecord>;
    const outcome = parsed.outcome === "completed" || parsed.outcome === "dismissed" ? parsed.outcome : "dismissed";
    return { available: true, record: { outcome, at: typeof parsed.at === "string" ? parsed.at : "" } };
  } catch {
    // Unreadable storage or a corrupt value: never nag.
    return { available: false };
  }
}

export function writeOrientation(storage: WritableStorage | null, outcome: OrientationOutcome, now: Date): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ORIENTATION_STORAGE_KEY, JSON.stringify({ outcome, at: now.toISOString() } satisfies OrientationRecord));
    return true;
  } catch {
    return false;
  }
}

export interface ProgressSignals {
  records: number;
  legacyRecords: number;
  xp: number;
  hasDepartment: boolean;
}

/** Prior play or career choices: such players already know the place. */
export const hasPriorProgress = (p: ProgressSignals) => p.records > 0 || p.legacyRecords > 0 || p.xp > 0 || p.hasDepartment;

export interface AutoShowInput {
  memory: OrientationMemory | null;
  /** Auth restored and the active career loaded, so progress is known. */
  ready: boolean;
  progress: ProgressSignals;
  /** Any app has a timed round in progress (or being verified). */
  busy: boolean;
}

export function shouldAutoShowOrientation({ memory, ready, progress, busy }: AutoShowInput): boolean {
  if (!ready || busy || !memory?.available || memory.record) return false;
  return !hasPriorProgress(progress);
}

// --- Browser binding ---------------------------------------------------------

const browserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let cached: { raw: string | null; memory: OrientationMemory } | null = null;
function snapshot(): OrientationMemory {
  const storage = browserStorage();
  let raw: string | null;
  try {
    raw = storage ? storage.getItem(ORIENTATION_STORAGE_KEY) : null;
  } catch {
    raw = "\u0000unavailable";
  }
  // Same value → same object, as useSyncExternalStore requires.
  if (!cached || cached.raw !== raw) cached = { raw, memory: readOrientation(storage) };
  return cached.memory;
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** What this browser remembers about the orientation. Null during server rendering. */
export function useOrientationMemory(): OrientationMemory | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export function rememberOrientation(outcome: OrientationOutcome) {
  writeOrientation(browserStorage(), outcome, new Date());
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
