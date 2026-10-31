/**
 * Career history persistence.
 *
 * The interface is async so a server-backed adapter (accounts, server-validated
 * results) can replace localStorage later without changing callers. Today's
 * adapter stores everything in this browser only.
 */
import { emptyCareerSave, parseCareerSave, type CareerSave } from "@/performance/schema";
import type { CloudProfile, LegacyRecord } from "@/types/cloud-career";

export const CAREER_STORAGE_KEY = "corporate-ladder.career";

export type LoadStatus =
  /** Valid data loaded. */
  | "ok"
  /** Nothing saved yet. */
  | "empty"
  /** Data was damaged; it was backed up and the usable part (or a fresh save) loaded. */
  | "recovered"
  /** Storage can't be used (private mode, blocked, unsupported). */
  | "unavailable"
  /** Saved by a newer app version. Loaded read-only so it is never overwritten. */
  | "unsupportedVersion"
  /** Cloud: the server couldn't be reached. */
  | "offline"
  /** Cloud: the session expired or was revoked. */
  | "unauthorized";

export interface LoadResult {
  save: CareerSave;
  status: LoadStatus;
  /** Whether saving is allowed. False for unavailable storage and newer schema versions. */
  writable: boolean;
  droppedRecords: number;
  /** Cloud only: authoritative XP and account data from the server. */
  cloud?: {
    totalXp: number;
    profile: CloudProfile;
    legacy: LegacyRecord[];
    departments: { id: string; name: string }[];
  };
}

export interface CareerRepository {
  load(): Promise<LoadResult>;
  /** Persists the full save. Rejects if the data could not be stored. */
  save(save: CareerSave): Promise<void>;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Accessing localStorage can throw (e.g. blocked cookies).
  }
}

export function createLocalStorageCareerRepository(
  getStorage: () => Storage | null = browserStorage,
  key: string = CAREER_STORAGE_KEY,
): CareerRepository {
  const backup = (storage: Storage, raw: string) => {
    try {
      storage.setItem(`${key}.corrupt`, raw);
    } catch {
      // Best effort only.
    }
  };

  return {
    async load() {
      const storage = getStorage();
      if (!storage) return { save: emptyCareerSave(), status: "unavailable", writable: false, droppedRecords: 0 };

      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch {
        return { save: emptyCareerSave(), status: "unavailable", writable: false, droppedRecords: 0 };
      }
      if (raw === null) return { save: emptyCareerSave(), status: "empty", writable: true, droppedRecords: 0 };

      const parsed = parseCareerSave(raw);
      switch (parsed.kind) {
        case "ok":
          if (parsed.droppedRecords > 0) backup(storage, raw);
          return {
            save: parsed.save,
            status: parsed.droppedRecords > 0 ? "recovered" : "ok",
            writable: true,
            droppedRecords: parsed.droppedRecords,
          };
        case "corrupt":
          backup(storage, raw);
          return { save: emptyCareerSave(), status: "recovered", writable: true, droppedRecords: 0 };
        case "unsupportedVersion":
          return { save: emptyCareerSave(), status: "unsupportedVersion", writable: false, droppedRecords: 0 };
      }
    },

    async save(save) {
      const storage = getStorage();
      if (!storage) throw new Error("Storage unavailable");
      storage.setItem(key, JSON.stringify(save)); // May throw (quota exceeded, blocked).
    },
  };
}

/** In-memory adapter for tests and environments without storage. */
export function createMemoryCareerRepository(initial: CareerSave = emptyCareerSave()): CareerRepository & { saved: CareerSave } {
  const repository = {
    saved: initial,
    async load(): Promise<LoadResult> {
      return { save: repository.saved, status: repository.saved.records.length ? "ok" : "empty", writable: true, droppedRecords: 0 };
    },
    async save(save: CareerSave) {
      repository.saved = save;
    },
  };
  return repository;
}
