import type { GameResultRecord } from "./progression";

/** API contract for the signed-in player's cloud career. */
export interface CloudProfile {
  userId: string;
  employeeNumber: string;
  displayName: string;
  departmentId: string | null;
  createdAt: string;
}

/** Guest history imported from a browser. Unverified: never counts toward XP or rankings. */
export interface LegacyRecord {
  localId: string;
  record: GameResultRecord;
  importedAt: string;
}

export interface CareerResponse {
  profile: CloudProfile;
  /** Authoritative Corporate XP: the sum of the player's ledger. */
  totalXp: number;
  /** Server-verified results, newest first. */
  records: GameResultRecord[];
  legacy: LegacyRecord[];
  departments: { id: string; name: string }[];
}

export interface ImportResponse {
  imported: number;
  alreadyImported: number;
  invalid: number;
}
