import { describe, expect, it } from "vitest";
import { DEPARTMENT_TRANSFER_COOLDOWN_DAYS, nextTransferAt, summarizeDepartmentCareer, type MembershipRow } from "./department-membership";

const row = (overrides: Partial<MembershipRow>): MembershipRow => ({
  id: "m1",
  department_id: "finance",
  started_at: "2026-11-01T09:00:00+00",
  ended_at: null,
  start_reason: "initial",
  end_reason: null,
  ...overrides,
});

describe("summarizeDepartmentCareer", () => {
  it("is empty and free to choose before the first selection", () => {
    const summary = summarizeDepartmentCareer([], [], new Date("2026-11-05T00:00:00Z"));
    expect(summary).toMatchObject({ current: null, history: [], nextTransferAt: null, canTransferNow: true, cooldownDays: 30, progress: [] });
  });

  it("finds the current membership and computes the 30-day cooldown from database timestamps", () => {
    const summary = summarizeDepartmentCareer([row({})], [], new Date("2026-11-30T08:59:59Z"));
    expect(summary.current).toMatchObject({ id: "m1", departmentId: "finance", startedAt: "2026-11-01T09:00:00.000Z" });
    expect(summary.nextTransferAt).toBe("2026-12-01T09:00:00.000Z");
    expect(summary.canTransferNow).toBe(false);
    expect(summarizeDepartmentCareer([row({})], [], new Date("2026-12-01T09:00:00Z")).canTransferNow).toBe(true);
    expect(DEPARTMENT_TRANSFER_COOLDOWN_DAYS).toBe(30);
  });

  it("lists history newest first and progress for every department worked in, current first", () => {
    const rows = [
      row({ id: "a", department_id: "sales", started_at: "2026-07-01T00:00:00Z", ended_at: "2026-08-15T00:00:00Z", end_reason: "transfer" }),
      row({ id: "b", department_id: "controlling", started_at: "2026-08-15T00:00:00Z", start_reason: "transfer" }),
    ];
    const summary = summarizeDepartmentCareer(rows, [], new Date("2026-11-01T00:00:00Z"));
    expect(summary.history.map((m) => m.id)).toEqual(["b", "a"]);
    expect(summary.progress.map((p) => p.departmentId)).toEqual(["controlling", "sales"]);
    expect(summary.canTransferNow).toBe(true);
  });

  it("ignores unknown department ids in progress but keeps them in history", () => {
    const summary = summarizeDepartmentCareer([row({ department_id: "retired-dept" })], [], new Date());
    expect(summary.history).toHaveLength(1);
    expect(summary.progress).toEqual([]);
  });

  it("computes no next transfer without a membership", () => {
    expect(nextTransferAt(null)).toBeNull();
  });
});
