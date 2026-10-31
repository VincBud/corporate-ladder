/** Builds the employee shown across LadderOS from the active career. */
import type { Employee } from "@/types/employee";
import type { CareerState } from "./career-store";

export function employeeFor(base: Employee, career: CareerState): Employee {
  if (career.source !== "cloud") return { ...base, xp: base.xp + career.earnedXp };
  const profile = career.profile;
  if (!profile) return { ...base, displayName: "Signing in…", xp: 0, isGuest: false };
  const department = career.departments.find((d) => d.id === profile.departmentId)?.name;
  return {
    ...base,
    id: profile.userId,
    displayName: profile.displayName,
    employeeNumber: profile.employeeNumber,
    department: department ?? "Unassigned (pending reorg)",
    joinedOn: profile.createdAt.slice(0, 10),
    // Cloud XP comes only from the server's verified ledger.
    xp: career.earnedXp,
    isGuest: false,
  };
}
