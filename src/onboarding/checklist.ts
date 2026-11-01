/**
 * The desktop's onboarding checklist: optional discovery milestones, each
 * done only when the player actually did it.
 */
import { useSyncExternalStore } from "react";
import { APP_IDS, type AppId } from "@/types/app";

export interface Milestone {
  id: "first-assignment" | "career" | "department" | "company";
  label: string;
  appId: AppId;
  done: boolean;
}

export interface MilestoneInput {
  /** Rounds in the active career (guest practice or verified). */
  records: number;
  hasDepartment: boolean;
  visited: ReadonlySet<AppId>;
}

export function onboardingMilestones({ records, hasDepartment, visited }: MilestoneInput): Milestone[] {
  return [
    { id: "first-assignment", label: "Complete your first assignment", appId: "spreadsheet-wars", done: records > 0 },
    { id: "career", label: "Explore your career", appId: "career", done: visited.has("career") },
    { id: "department", label: "Choose a department", appId: "departments", done: hasDepartment },
    { id: "company", label: "Visit the Company dashboard", appId: "company", done: visited.has("company") },
  ];
}

export const VISITED_APPS_STORAGE_KEY = "corporate-ladder.visited-apps.v1";

export function readVisited(storage: Pick<Storage, "getItem"> | null, known: readonly AppId[]): Set<AppId> {
  try {
    const parsed = JSON.parse(storage?.getItem(VISITED_APPS_STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? (parsed.filter((id) => known.includes(id as AppId)) as AppId[]) : []);
  } catch {
    return new Set();
  }
}

export function writeVisited(storage: Pick<Storage, "setItem"> | null, visited: ReadonlySet<AppId>) {
  try {
    storage?.setItem(VISITED_APPS_STORAGE_KEY, JSON.stringify([...visited]));
  } catch {
    // Storage blocked: milestones still work for this visit.
  }
}

// --- Browser binding ---------------------------------------------------------

const CHANGE_EVENT = "corporate-ladder:visited-apps";
const EMPTY: ReadonlySet<AppId> = new Set();

const browserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

// Remembered for this page view even when storage is blocked.
let session = new Set<AppId>();
let cached: { key: string; value: ReadonlySet<AppId> } | null = null;
function snapshot(): ReadonlySet<AppId> {
  const merged = new Set([...readVisited(browserStorage(), APP_IDS), ...session]);
  const key = [...merged].sort().join(",");
  if (!cached || cached.key !== key) cached = { key, value: merged };
  return cached.value;
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** Apps opened in this browser. Empty during server rendering. */
export function useVisitedApps(): ReadonlySet<AppId> {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function markAppVisited(appId: AppId) {
  const current = snapshot();
  if (current.has(appId)) return;
  session = new Set([...session, appId]);
  writeVisited(browserStorage(), new Set([...current, appId]));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
