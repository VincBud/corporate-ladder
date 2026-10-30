"use client";

import { useEffect, useEffectEvent, useState } from "react";

/**
 * Re-renders with the current monotonic time while a round runs and reports
 * expiry once. Time comes from performance.now() on every update, so browser
 * timer throttling (background tabs, minimized windows) never stretches a
 * round; the next update simply sees that the deadline has passed.
 */
export function useRoundClock(startedAt: number, durationMs: number, onExpire: (now: number) => void): number {
  const [now, setNow] = useState(startedAt);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    let expired = false;
    const update = () => {
      const time = performance.now();
      setNow(time);
      if (!expired && time - startedAt >= durationMs) {
        expired = true;
        expire(time);
      }
    };
    const id = window.setInterval(update, 200);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", update);
    };
  }, [startedAt, durationMs]);

  return now;
}
