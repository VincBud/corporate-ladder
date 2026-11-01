/**
 * Browser state for the Employee Experience Survey: prompts shown, submission,
 * and the guest's random token. Shared across tabs through localStorage.
 * Client-side suppression only; the server deduplicates per request and per account.
 */
import { useSyncExternalStore } from "react";
import { GUEST_TOKEN_STORAGE_KEY, SURVEY_STORAGE_KEY, isUuid, parseMemory, type SurveyMemory } from "./survey";

const CHANGE_EVENT = "corporate-ladder:feedback";
const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let cached: { raw: string | null; memory: SurveyMemory | null } | null = null;
function snapshot(): SurveyMemory | null {
  const s = storage();
  let raw: string | null;
  try {
    raw = s ? s.getItem(SURVEY_STORAGE_KEY) : "\u0000blocked";
  } catch {
    raw = "\u0000blocked";
  }
  if (!cached || cached.raw !== raw) cached = { raw, memory: raw === "\u0000blocked" ? null : parseMemory(raw) };
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

/** Survey memory for this browser; null on the server or when storage is blocked. Shared across tabs. */
export function useSurveyMemory(): SurveyMemory | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

function update(change: (memory: SurveyMemory) => SurveyMemory) {
  const s = storage();
  try {
    s?.setItem(SURVEY_STORAGE_KEY, JSON.stringify(change(parseMemory(s.getItem(SURVEY_STORAGE_KEY)))));
  } catch {
    // Storage blocked: nothing to remember (and nothing is prompted automatically).
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Records an automatic prompt the moment it opens (also stops other tabs from prompting). */
export const recordAutoPrompt = (completedRounds: number) =>
  update((m) => ({ ...m, autoPrompts: m.autoPrompts + 1, lastPromptRounds: completedRounds }));

export const recordSubmitted = (submittedAt: string) => update((m) => ({ ...m, submittedAt }));

/** The guest's random token (created on first submission). Not an identity: it only groups that browser's revisions. */
export function guestToken(): string {
  const s = storage();
  try {
    const existing = s?.getItem(GUEST_TOKEN_STORAGE_KEY);
    if (existing && isUuid(existing)) return existing;
    const token = crypto.randomUUID();
    s?.setItem(GUEST_TOKEN_STORAGE_KEY, token);
    return token;
  } catch {
    return crypto.randomUUID();
  }
}
