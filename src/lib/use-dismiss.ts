"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

export type DismissReason = "escape" | "outside";

/**
 * Calls `onDismiss` on Escape or on pointer-down outside all `refs`.
 * Use for popovers and menus.
 */
export function useDismiss(
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onDismiss: (reason: DismissReason) => void,
  enabled = true,
) {
  const dismiss = useEffectEvent(onDismiss);
  const isInside = useEffectEvent((target: Node) => refs.some((ref) => ref.current?.contains(target)));

  useEffect(() => {
    if (!enabled) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !isInside(event.target)) dismiss("outside");
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss("escape");
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);
}
