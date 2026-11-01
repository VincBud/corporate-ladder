import type { DepartmentProgress } from "@/career/department-tracks";
import type { AchievementUnlock } from "./achievements";

/** One membership period (department_memberships row). Timestamps are database time. */
export interface MembershipRecord {
  id: string;
  departmentId: string;
  startedAt: string;
  endedAt: string | null;
  startReason: "initial" | "transfer" | "legacy";
  endReason: "transfer" | null;
}

/** The signed-in player's department career, as sent by GET /api/career. */
export interface DepartmentCareerSummary {
  current: MembershipRecord | null;
  /** Newest first, including the current membership. */
  history: MembershipRecord[];
  /** When the next transfer is allowed (null before the first selection). */
  nextTransferAt: string | null;
  canTransferNow: boolean;
  cooldownDays: number;
  /** Progress in every department the player has worked in, current first. */
  progress: DepartmentProgress[];
  /** Server time the summary was computed at. */
  serverNow: string;
}

export interface SelectDepartmentResponse {
  /** Achievements this change unlocked (empty on retries). */
  achievements?: AchievementUnlock[];
  status: "joined" | "transferred" | "duplicate";
  membership: MembershipRecord;
  nextTransferAt: string | null;
}
