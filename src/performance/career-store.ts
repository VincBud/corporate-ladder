/**
 * Client-side career state: loaded history, earned XP, per-session save
 * status and pending promotion notices. Framework-agnostic (subscribe +
 * snapshot) so React reads it through useSyncExternalStore and tests can
 * drive it directly.
 */
import type { ProgressChange } from "@/career/progression";
import type { XpAward } from "@/career/xp";
import { describeProgressChange } from "@/career/progression";
import type { CareerRepository, LoadResult, LoadStatus } from "@/services/career-repository";
import type { CloudProfile, LegacyRecord } from "@/types/cloud-career";
import type { SubmitRoundResponse } from "@/types/verified-play";
import type { GameResultInput, GameResultRecord } from "@/types/progression";
import { addResult, earnedXp } from "./ledger";
import { emptyCareerSave, type CareerSave } from "./schema";

export type SessionOutcome =
  | { status: "saving" }
  | { status: "saved"; record: GameResultRecord; award: XpAward | null; change: ProgressChange; duplicate: boolean }
  | { status: "failed"; reason: string };

export interface CareerState {
  /** "local": guest history in this browser. "cloud": the signed-in account. */
  source: "local" | "cloud";
  status: "loading" | "ready";
  loadStatus: LoadStatus | null;
  writable: boolean;
  records: readonly GameResultRecord[];
  earnedXp: number;
  sessions: ReadonlyMap<string, SessionOutcome>;
  /** Most recent promotion, until dismissed. */
  promotion: ProgressChange | null;
  /** Cloud only. */
  profile: CloudProfile | null;
  legacyRecords: readonly LegacyRecord[];
  departments: readonly { id: string; name: string }[];
}

export interface CareerStore {
  getState: () => CareerState;
  subscribe: (listener: () => void) => () => void;
  /** Loads (or reloads, e.g. after another tab saved) the history. */
  load: () => Promise<void>;
  /** Records a finished round exactly once per session id. Safe to call repeatedly. */
  recordResult: (sessionId: string, input: GameResultInput) => Promise<SessionOutcome>;
  dismissPromotion: () => void;
  /** Cloud: shows a result the server verified and recorded (no local write). */
  applyVerifiedResult: (sessionId: string, response: SubmitRoundResponse) => void;
}

export const INITIAL_CAREER_STATE: CareerState = {
  source: "local",
  status: "loading",
  loadStatus: null,
  writable: false,
  records: [],
  earnedXp: 0,
  sessions: new Map(),
  promotion: null,
  profile: null,
  legacyRecords: [],
  departments: [],
};

export function createCareerStore(
  repository: CareerRepository,
  options: { baselineXp?: number; source?: CareerState["source"] } = {},
): CareerStore {
  const baselineXp = options.baselineXp ?? 0;
  let state: CareerState = { ...INITIAL_CAREER_STATE, source: options.source ?? "local" };
  let save: CareerSave = emptyCareerSave();
  let loading: Promise<void> | null = null;
  const inFlight = new Map<string, Promise<SessionOutcome>>();
  const listeners = new Set<() => void>();

  const set = (patch: Partial<CareerState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const setSession = (sessionId: string, outcome: SessionOutcome, patch: Partial<CareerState> = {}) =>
    set({ ...patch, sessions: new Map(state.sessions).set(sessionId, outcome) });
  const applySave = (next: CareerSave) => {
    save = next;
    return { records: next.records, earnedXp: earnedXp(next.records) };
  };

  function applyLoad(result: LoadResult): Partial<CareerState> {
    if (!result.cloud) return applySave(result.save);
    save = result.save;
    return {
      records: result.save.records,
      // Cloud XP comes from the server's ledger, not from summing loaded rows.
      earnedXp: result.cloud.totalXp,
      profile: result.cloud.profile,
      legacyRecords: result.cloud.legacy,
      departments: result.cloud.departments,
    };
  }

  async function load() {
    let result: LoadResult;
    try {
      result = await repository.load();
    } catch {
      result = { save: emptyCareerSave(), status: "offline", writable: false, droppedRecords: 0 };
    }
    const failed = result.status === "offline" || result.status === "unauthorized";
    if (failed && state.status === "ready") {
      // Keep showing the last known data; just report the problem.
      set({ loadStatus: result.status });
      return;
    }
    set({ status: "ready", loadStatus: result.status, writable: result.writable, ...applyLoad(result) });
  }

  function ensureLoaded() {
    loading ??= load();
    return loading;
  }

  async function persist(sessionId: string, input: GameResultInput): Promise<SessionOutcome> {
    await ensureLoaded();
    if (!state.writable) {
      const outcome: SessionOutcome = { status: "failed", reason: "Career storage is unavailable in this browser." };
      setSession(sessionId, outcome);
      return outcome;
    }
    try {
      // Re-read before writing so a save from another tab isn't lost.
      const latest = await repository.load();
      const base = latest.writable ? latest.save : save;
      const result = addResult(base, sessionId, input, baselineXp);
      if (!result.duplicate) await repository.save(result.save);

      const outcome: SessionOutcome = {
        status: "saved",
        record: result.record,
        award: result.award,
        change: result.change,
        duplicate: result.duplicate,
      };
      setSession(sessionId, outcome, {
        ...applySave(result.save),
        ...(result.change.promoted && !result.duplicate ? { promotion: result.change } : {}),
      });
      return outcome;
    } catch {
      const outcome: SessionOutcome = { status: "failed", reason: "This result could not be saved." };
      setSession(sessionId, outcome);
      return outcome;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      void ensureLoaded();
      return () => listeners.delete(listener);
    },
    load() {
      loading = load();
      return loading;
    },
    recordResult(sessionId, input) {
      // Concurrent or repeated calls for the same round share one save.
      const pending = inFlight.get(sessionId);
      if (pending) return pending;
      setSession(sessionId, { status: "saving" });
      const promise = persist(sessionId, input).finally(() => {
        // Allow a retry after a failure; successful sessions stay deduplicated by id.
        if (state.sessions.get(sessionId)?.status === "failed") inFlight.delete(sessionId);
      });
      inFlight.set(sessionId, promise);
      return promise;
    },
    dismissPromotion() {
      if (state.promotion) set({ promotion: null });
    },
    applyVerifiedResult(sessionId, response) {
      const { record, totalXp, created } = response;
      const xpBefore = baselineXp + totalXp - (created ? record.xpAwarded : 0);
      const change = describeProgressChange(xpBefore, baselineXp + totalXp);
      const records = [record, ...state.records.filter((r) => r.id !== record.id)];
      const outcome: SessionOutcome = {
        status: "saved",
        record,
        award: created ? { xp: record.xpAwarded, reason: record.xpAwarded > 0 ? "score" : "noScore" } : null,
        change,
        duplicate: !created,
      };
      setSession(sessionId, outcome, {
        records,
        earnedXp: totalXp,
        ...(change.promoted && created ? { promotion: change } : {}),
      });
      void load(); // refresh profile and history from the server
    },
  };
}
