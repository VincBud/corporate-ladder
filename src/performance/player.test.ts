import { describe, expect, it } from "vitest";
import { getCurrentEmployee } from "@/services/employee-service";
import { INITIAL_CAREER_STATE } from "./career-store";
import { employeeFor } from "./player";

const base = getCurrentEmployee();

describe("employeeFor", () => {
  it("adds local XP to the guest identity", () => {
    expect(employeeFor(base, { ...INITIAL_CAREER_STATE, earnedXp: 52 })).toMatchObject({ isGuest: true, xp: 52, displayName: "Guest Employee" });
  });

  it("uses only the cloud profile and server XP for signed-in players", () => {
    const employee = employeeFor(base, {
      ...INITIAL_CAREER_STATE,
      source: "cloud",
      earnedXp: 340,
      profile: { userId: "u1", employeeNumber: "CL-001234", displayName: "Alice", departmentId: "finance", createdAt: "2026-10-30T12:00:00Z" },
      departments: [{ id: "finance", name: "Finance" }],
    });
    expect(employee).toMatchObject({ id: "u1", displayName: "Alice", employeeNumber: "CL-001234", department: "Finance", xp: 340, isGuest: false, joinedOn: "2026-10-30" });
  });

  it("never shows guest XP while a signed-in profile is loading", () => {
    expect(employeeFor(base, { ...INITIAL_CAREER_STATE, source: "cloud", earnedXp: 0 })).toMatchObject({ isGuest: false, xp: 0 });
  });
});
