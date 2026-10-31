/**
 * Versioned save format for the player's career history, with validation and
 * migrations. Storage-agnostic: adapters pass raw text in and get a save out.
 */
import { GAME_IDS, type GameResultRecord } from "@/types/progression";

export const CAREER_SCHEMA_VERSION = 1;

export interface CareerSave {
  version: typeof CAREER_SCHEMA_VERSION;
  records: GameResultRecord[];
}

export const emptyCareerSave = (): CareerSave => ({ version: CAREER_SCHEMA_VERSION, records: [] });

export type ParseResult =
  | { kind: "ok"; save: CareerSave; droppedRecords: number }
  | { kind: "corrupt"; reason: string }
  /** Written by a newer version of the app: never overwrite it. */
  | { kind: "unsupportedVersion"; version: number };

/** Upgrades data from version N to N+1. Add an entry whenever the schema changes. */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;

/** Returns a clean record, or null if anything is missing or out of range. */
export function parseRecord(value: unknown): GameResultRecord | null {
  if (!isObject(value)) return null;
  const v = value;
  const valid =
    isText(v.id) &&
    typeof v.gameId === "string" &&
    (GAME_IDS as readonly string[]).includes(v.gameId) &&
    isCount(v.scoringVersion) &&
    isText(v.seed) &&
    isText(v.department) &&
    isText(v.difficulty) &&
    isText(v.completedAt) &&
    !Number.isNaN(Date.parse(v.completedAt as string)) &&
    (v.completion === "submitted" || v.completion === "timedOut") &&
    isNumber(v.score) &&
    (v.score as number) >= 0 &&
    isNumber(v.maxScore) &&
    (v.maxScore as number) > 0 &&
    isText(v.grade) &&
    isCount(v.errorsFixed) &&
    isCount(v.totalErrors) &&
    (v.errorsFixed as number) <= (v.totalErrors as number) &&
    isCount(v.incorrectCorrections) &&
    (v.accuracy === null || (isNumber(v.accuracy) && (v.accuracy as number) >= 0 && (v.accuracy as number) <= 1)) &&
    isNumber(v.timeUsedMs) &&
    (v.timeUsedMs as number) >= 0 &&
    isNumber(v.timeRemainingMs) &&
    (v.timeRemainingMs as number) >= 0 &&
    typeof v.assistanceUsed === "boolean" &&
    isCount(v.xpAwarded);
  if (!valid) return null;

  // Copy known fields only, so unexpected extra data is never carried forward.
  return {
    id: v.id as string,
    gameId: v.gameId as GameResultRecord["gameId"],
    scoringVersion: v.scoringVersion as number,
    seed: v.seed as string,
    department: v.department as string,
    difficulty: v.difficulty as string,
    completedAt: v.completedAt as string,
    completion: v.completion as GameResultRecord["completion"],
    score: v.score as number,
    maxScore: v.maxScore as number,
    grade: v.grade as string,
    errorsFixed: v.errorsFixed as number,
    totalErrors: v.totalErrors as number,
    incorrectCorrections: v.incorrectCorrections as number,
    accuracy: v.accuracy as number | null,
    timeUsedMs: v.timeUsedMs as number,
    timeRemainingMs: v.timeRemainingMs as number,
    assistanceUsed: v.assistanceUsed as boolean,
    xpAwarded: v.xpAwarded as number,
  };
}

/** Applies migrations from `version` up to the current version. Null if a step is missing. */
export function migrate(
  data: Record<string, unknown>,
  version: number,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): Record<string, unknown> | null {
  let current = data;
  for (let v = version; v < CAREER_SCHEMA_VERSION; v++) {
    const step = migrations[v];
    if (!step) return null;
    current = step(current);
  }
  return current;
}

export function parseCareerSave(text: string, migrations: Readonly<Record<number, Migration>> = MIGRATIONS): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: "corrupt", reason: "not valid JSON" };
  }
  if (!isObject(data) || !Number.isInteger(data.version) || (data.version as number) < 1) {
    return { kind: "corrupt", reason: "missing schema version" };
  }
  const version = data.version as number;
  if (version > CAREER_SCHEMA_VERSION) return { kind: "unsupportedVersion", version };

  const migrated = migrate(data, version, migrations);
  if (!migrated || !Array.isArray(migrated.records)) return { kind: "corrupt", reason: "unreadable records" };

  const seen = new Set<string>();
  const records: GameResultRecord[] = [];
  for (const raw of migrated.records) {
    const record = parseRecord(raw);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return {
    kind: "ok",
    save: { version: CAREER_SCHEMA_VERSION, records },
    droppedRecords: migrated.records.length - records.length,
  };
}
