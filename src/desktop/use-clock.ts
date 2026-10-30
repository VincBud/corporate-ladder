import { useSyncExternalStore } from "react";

function subscribe(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}

// Floored to the minute so the snapshot is stable between ticks.
const getSnapshot = () => Math.floor(Date.now() / 60_000) * 60_000;

// Time is unknown while prerendering; render a placeholder instead of a
// value that would mismatch on hydration.
const getServerSnapshot = () => null;

/** Current time in ms, floored to the minute. `null` on the server. */
export function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
