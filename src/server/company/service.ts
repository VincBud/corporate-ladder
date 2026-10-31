import "server-only";
/**
 * Live company snapshot (server only). Reads one quarter of verified data
 * through the service-role function get_company_quarter, runs the
 * simulation engine (simulation/live.ts) and returns the public,
 * aggregate-only snapshot.
 *
 * Snapshots are cached per server instance for a short time and loaded
 * single-flight, so a burst of requests causes one database read. A verified
 * submission handled by this instance invalidates the cache immediately.
 */
import { isPeriodId } from "@/simulation/periods";
import { FormulaMismatchError, buildLiveSnapshot, type AllocationRow, type LiveQuarterInput } from "@/simulation/live";
import type { CompanySnapshot, ContributionEventRow } from "@/simulation/source";
import type { RpcCall } from "../rounds/round-store";

export const COMPANY_SNAPSHOT_TTL_MS = 15_000;

export class CompanyUnavailableError extends Error {
  constructor(
    readonly reason: "database" | "malformed" | "formula",
    message: string,
  ) {
    super(message);
    this.name = "CompanyUnavailableError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Validates the database payload. Anything unexpected is treated as unavailable, never guessed. */
export function parseQuarterData(raw: unknown): LiveQuarterInput {
  const fail = (what: string): never => {
    throw new CompanyUnavailableError("malformed", `Unexpected company data: ${what}`);
  };
  if (!isObject(raw)) return fail("not an object");
  if (!isPeriodId(raw.period_id) || raw.period_id !== raw.current_period) fail("period");
  if (typeof raw.db_now !== "string" || !Number.isFinite(Date.parse(raw.db_now))) fail("timestamp");
  if (!isCount(raw.registered_employees)) fail("employee count");
  if (!Array.isArray(raw.membership) || !Array.isArray(raw.events) || !Array.isArray(raw.allocations)) fail("lists");

  const membership = (raw.membership as unknown[]).map((m) => {
    if (!isObject(m) || !(m.department_id === null || typeof m.department_id === "string") || !isCount(Number(m.members))) fail("membership");
    const row = m as Record<string, unknown>;
    return { departmentId: row.department_id as string | null, members: Number(row.members) };
  });
  if (membership.reduce((sum, m) => sum + m.members, 0) !== raw.registered_employees) fail("membership total");

  const events = (raw.events as unknown[]).map((e) => {
    if (!isObject(e) || typeof e.user_id !== "string" || typeof e.session_id !== "string" || e.period_id !== raw.period_id) fail("event");
    return e as unknown as ContributionEventRow & { department_id: string | null };
  });
  const allocations = (raw.allocations as unknown[]).map((a) => {
    if (!isObject(a) || typeof a.game_id !== "string" || !isCount(a.formula_version) || typeof a.metric_id !== "string" || !isCount(a.weight_bp)) {
      fail("allocation");
    }
    return a as unknown as AllocationRow;
  });
  if (!(raw.last_contribution_at === null || typeof raw.last_contribution_at === "string")) fail("last contribution");

  return {
    periodId: raw.period_id as LiveQuarterInput["periodId"],
    generatedAt: raw.db_now as string,
    registeredEmployees: raw.registered_employees as number,
    membership,
    events,
    allocations,
    lastContributionAt: raw.last_contribution_at as string | null,
  };
}

export interface CompanyService {
  getSnapshot(): Promise<CompanySnapshot>;
  /** Drops the cached snapshot, e.g. after a verified submission. */
  invalidate(): void;
}

export function createCompanyService({ rpc, ttlMs = COMPANY_SNAPSHOT_TTL_MS, now = Date.now }: { rpc: RpcCall; ttlMs?: number; now?: () => number }): CompanyService {
  let cached: { snapshot: CompanySnapshot; expiresAt: number } | null = null;
  let inflight: Promise<CompanySnapshot> | null = null;
  let generation = 0;

  async function load(): Promise<CompanySnapshot> {
    const started = generation;
    let raw: unknown;
    try {
      // The database decides the current quarter (null = now in UTC).
      raw = await rpc("get_company_quarter", { p_period_id: null });
    } catch (error) {
      throw new CompanyUnavailableError("database", error instanceof Error ? error.message : "Database error");
    }
    try {
      const { snapshot } = buildLiveSnapshot(parseQuarterData(raw));
      // Don't cache a snapshot that an invalidation overtook while loading.
      if (started === generation) cached = { snapshot, expiresAt: now() + ttlMs };
      return snapshot;
    } catch (error) {
      if (error instanceof CompanyUnavailableError) throw error;
      if (error instanceof FormulaMismatchError) throw new CompanyUnavailableError("formula", error.message);
      throw new CompanyUnavailableError("malformed", error instanceof Error ? error.message : "Invalid company data");
    }
  }

  return {
    async getSnapshot() {
      if (cached && cached.expiresAt > now()) return cached.snapshot;
      inflight ??= load().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate() {
      generation++;
      cached = null;
    },
  };
}
