/** Unique id for a played round. Call from event handlers, never during render. */
export function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for non-secure contexts where randomUUID is unavailable.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
