/**
 * Small in-memory sliding-window limiter, per key (e.g. user + action).
 * Best effort: each server instance has its own memory. The database enforces
 * the authoritative per-player limit on round creation.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns whether it is allowed. */
  take(key: string): boolean {
    const time = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > time - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(time);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(time);
    return true;
  }

  private prune(time: number) {
    for (const [key, list] of this.hits) {
      if (list.every((t) => t <= time - this.windowMs)) this.hits.delete(key);
    }
  }
}
