/**
 * One-shot requests for how an app should open (e.g. the orientation's
 * "Play your first assignment" opens Spreadsheet Wars at the briefing).
 * The app consumes the intent once; nothing starts by itself.
 */
import type { AppId } from "@/types/app";

export type LaunchIntent = "briefing";

const pending = new Map<AppId, LaunchIntent>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function requestLaunchIntent(appId: AppId, intent: LaunchIntent) {
  pending.set(appId, intent);
  emit();
}

/** Returns and clears the app's pending intent. */
export function takeLaunchIntent(appId: AppId): LaunchIntent | null {
  const intent = pending.get(appId) ?? null;
  if (intent) {
    pending.delete(appId);
    emit();
  }
  return intent;
}

/**
 * Calls `handler` whenever the app has a pending intent, including one that
 * was requested before the app mounted. The handler decides whether to take it.
 */
export function onLaunchIntent(appId: AppId, handler: (intent: LaunchIntent) => void): () => void {
  let active = true;
  const check = () => {
    const intent = pending.get(appId);
    if (active && intent) handler(intent);
  };
  listeners.add(check);
  queueMicrotask(check);
  return () => {
    active = false;
    listeners.delete(check);
  };
}
