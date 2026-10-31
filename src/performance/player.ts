/** Builds the employee shown across LadderOS from the active career. */
import { DEPARTMENT_TRACKS, type DepartmentProgress } from "@/career/department-tracks";
import { departmentDisplayName, getCanonicalDepartment, isCanonicalDepartmentId, type CanonicalDepartmentId } from "@/config/departments";
import type { Employee } from "@/types/employee";
import type { CareerState } from "./career-store";

export interface DepartmentRole {
  departmentId: CanonicalDepartmentId;
  name: string;
  /** Current position title in the department's career track. */
  title: string;
  progress: DepartmentProgress;
}

/** The signed-in player's current department and position, or null (guest, loading or none chosen). */
export function departmentRoleFor(career: CareerState): DepartmentRole | null {
  const current = career.departmentCareer?.current;
  if (!current || !isCanonicalDepartmentId(current.departmentId)) return null;
  const progress = career.departmentCareer!.progress.find((p) => p.departmentId === current.departmentId);
  if (!progress) return null;
  return {
    departmentId: current.departmentId,
    name: getCanonicalDepartment(current.departmentId).name,
    title: DEPARTMENT_TRACKS[current.departmentId][progress.positionIndex].title,
    progress,
  };
}

export function employeeFor(base: Employee, career: CareerState): Employee {
  if (career.source !== "cloud") return { ...base, xp: base.xp + career.earnedXp };
  const profile = career.profile;
  if (!profile) return { ...base, displayName: "Signing in…", xp: 0, isGuest: false };
  const role = departmentRoleFor(career);
  return {
    ...base,
    id: profile.userId,
    displayName: profile.displayName,
    employeeNumber: profile.employeeNumber,
    department: role?.name ?? departmentDisplayName(profile.departmentId) ?? "Unassigned (pending reorg)",
    jobTitle: role?.title ?? null,
    joinedOn: profile.createdAt.slice(0, 10),
    // Cloud XP comes only from the server's verified ledger.
    xp: career.earnedXp,
    isGuest: false,
  };
}
