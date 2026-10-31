/**
 * Department membership summary (pure). The rules are enforced by the
 * database function select_department; this only describes the state for
 * display, using the same 30-day cooldown.
 */
import { getCanonicalDepartment, isCanonicalDepartmentId } from "@/config/departments";
import type { DepartmentCareerSummary, MembershipRecord } from "@/types/department-career";
import type { GameResultRecord } from "@/types/progression";
import { departmentProgress } from "./department-tracks";

export const DEPARTMENT_TRANSFER_COOLDOWN_DAYS = 30;
const DAY_MS = 86_400_000;

export interface MembershipRow {
  id: string;
  department_id: string;
  started_at: string | Date;
  ended_at: string | Date | null;
  start_reason: MembershipRecord["startReason"];
  end_reason: MembershipRecord["endReason"];
}

/** Parses Postgres timestamps, including short offsets like "+00" that Date can't read. */
export function parseDbTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new RangeError(`Invalid timestamp: ${value}`);
  return new Date(time).toISOString();
}

export const toMembershipRecord = (row: MembershipRow): MembershipRecord => ({
  id: row.id,
  departmentId: row.department_id,
  startedAt: parseDbTimestamp(row.started_at),
  endedAt: row.ended_at === null ? null : parseDbTimestamp(row.ended_at),
  startReason: row.start_reason,
  endReason: row.end_reason,
});

export function nextTransferAt(current: MembershipRecord | null): string | null {
  return current ? new Date(Date.parse(current.startedAt) + DEPARTMENT_TRANSFER_COOLDOWN_DAYS * DAY_MS).toISOString() : null;
}

export function summarizeDepartmentCareer(rows: readonly MembershipRow[], records: readonly GameResultRecord[], now: Date): DepartmentCareerSummary {
  const history = rows.map(toMembershipRecord).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  const current = history.find((m) => m.endedAt === null) ?? null;
  const next = nextTransferAt(current);
  const departments = [...new Set([current?.departmentId, ...history.map((m) => m.departmentId)].filter((id): id is string => !!id))];
  return {
    current,
    history,
    nextTransferAt: next,
    canTransferNow: next === null || Date.parse(next) <= now.getTime(),
    cooldownDays: DEPARTMENT_TRANSFER_COOLDOWN_DAYS,
    progress: departments
      .filter(isCanonicalDepartmentId)
      .map((id) => departmentProgress(id, history, records, getCanonicalDepartment(id).plannedGames)),
    serverNow: now.toISOString(),
  };
}
