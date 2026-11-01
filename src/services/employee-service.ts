import type { Employee } from "@/types/employee";

/**
 * Employee data access. Today this returns a local guest identity.
 * Future: resolve the Supabase session on the server and load the employee
 * row from Postgres. Keep callers on the server so that swap stays local.
 */
const GUEST_EMPLOYEE: Employee = {
  id: "guest",
  displayName: "Guest Employee",
  employeeNumber: "CL-000417",
  department: "Unassigned (pending reorg)",
  manager: "To be determined",
  location: "Hot desk near the printer",
  xp: 0,
  joinedOn: "2026-10-30",
  isGuest: true,
};

export function getCurrentEmployee(): Employee {
  return GUEST_EMPLOYEE;
}
