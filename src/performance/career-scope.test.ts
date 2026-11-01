import { describe, expect, it } from "vitest";
import { createMemoryCareerRepository, type CareerRepository } from "@/services/career-repository";
import { createCloudCareerRepository } from "@/services/cloud-career-repository";
import { ApiError } from "@/services/api-client";
import type { CareerResponse } from "@/types/cloud-career";
import type { SubmitRoundResponse } from "@/types/verified-play";
import { GUEST_SCOPE, careerScopeFor, createCareerRegistry } from "./career-scope";
import { createCareerStore } from "./career-store";
import { resultInput } from "./test-fixtures";

const profile = (userId: string) => ({ userId, employeeNumber: "CL-001000", displayName: "Alice", departmentId: null, createdAt: "2026-10-30T00:00:00Z" });
const record = (id: string, xp: number) => ({ ...resultInput(), id, xpAwarded: xp });

function cloudResponse(userId: string, xp: number, records = [record(`${userId}-r1`, xp)]): CareerResponse {
  return {
    profile: profile(userId),
    totalXp: xp,
    records,
    legacy: [],
    departments: [{ id: "finance", name: "Finance" }],
    departmentCareer: { current: null, history: [], nextTransferAt: null, canTransferNow: true, cooldownDays: 30, progress: [], serverNow: "2026-10-30T00:00:00Z" },
    achievements: null,
  };
}

describe("career scope", () => {
  it("picks the guest or account career, and nothing while auth is loading", () => {
    expect(careerScopeFor({ status: "loading", user: null })).toBeNull();
    expect(careerScopeFor({ status: "disabled", user: null })).toBe(GUEST_SCOPE);
    expect(careerScopeFor({ status: "signedOut", user: null })).toBe(GUEST_SCOPE);
    expect(careerScopeFor({ status: "signedIn", user: { id: "u1", email: null, emailConfirmed: true } })).toBe("user:u1");
  });

  it("keeps guest and account careers apart and forgets the previous account on switch", async () => {
    const local = createMemoryCareerRepository();
    const cloudByUser = new Map([
      ["u1", cloudResponse("u1", 120)],
      ["u2", cloudResponse("u2", 40)],
    ]);
    let currentUser = "u1";
    const created: string[] = [];
    const registry = createCareerRegistry({
      localRepository: () => local,
      cloudRepository: () => {
        const user = currentUser;
        return createCloudCareerRepository(async () => cloudByUser.get(user)!);
      },
      baselineXp: 0,
      onCreate: (scope) => {
        created.push(scope);
      },
    });

    const guest = registry.get(GUEST_SCOPE);
    await guest.recordResult("g1", resultInput({ seed: "RR-G" }));
    const u1 = registry.get("user:u1");
    await u1.load();
    expect(u1.getState()).toMatchObject({ source: "cloud", earnedXp: 120, profile: { userId: "u1" } });

    currentUser = "u2";
    const u2 = registry.get("user:u2");
    await u2.load();
    expect(registry.scopes()).toEqual([GUEST_SCOPE, "user:u2"]);
    expect(u2.getState().earnedXp).toBe(40);
    expect(u2.getState().records.every((r) => r.id.startsWith("u2"))).toBe(true);
    // The guest's local history was never touched by either account.
    expect(guest.getState().records.map((r) => r.id)).toEqual(["g1"]);

    registry.dropSignedIn();
    expect(registry.scopes()).toEqual([GUEST_SCOPE]);
    expect(created).toEqual([GUEST_SCOPE, "user:u1", "user:u2"]);
  });
});

describe("cloud career store", () => {
  it("uses the server's XP total and keeps last known data when a refresh fails", async () => {
    let fail: ApiError | null = null;
    const repo = createCloudCareerRepository(async () => {
      if (fail) throw fail;
      return cloudResponse("u1", 300);
    });
    const store = createCareerStore(repo, { source: "cloud" });
    await store.load();
    expect(store.getState()).toMatchObject({ status: "ready", earnedXp: 300, writable: false });

    fail = new ApiError(0, "network", "offline");
    await store.load();
    expect(store.getState()).toMatchObject({ loadStatus: "offline", earnedXp: 300 });
    expect(store.getState().records).toHaveLength(1);

    fail = new ApiError(401, "unauthorized", "expired");
    await store.load();
    expect(store.getState().loadStatus).toBe("unauthorized");
  });

  it("refuses local writes: cloud results only come from the server", async () => {
    const store = createCareerStore(createCloudCareerRepository(async () => cloudResponse("u1", 0, [])), { source: "cloud" });
    expect((await store.recordResult("s1", resultInput())).status).toBe("failed");
    expect(store.getState().earnedXp).toBe(0);
  });

  it("shows a verified result immediately and announces promotions once", async () => {
    let server = cloudResponse("u1", 290, []);
    const store = createCareerStore(createCloudCareerRepository(async () => server), { source: "cloud" });
    await store.load();
    const verified = record("s1", 52);
    const response = { record: verified, created: true, totalXp: 342, review: {} } as unknown as SubmitRoundResponse;
    server = cloudResponse("u1", 342, [verified]);
    store.applyVerifiedResult("s1", response);
    expect(store.getState().earnedXp).toBe(342);
    expect(store.getState().sessions.get("s1")).toMatchObject({ status: "saved", duplicate: false });
    expect(store.getState().promotion?.rankAfter.title).toBe("Intern");

    store.dismissPromotion();
    store.applyVerifiedResult("s1", { ...response, created: false });
    expect(store.getState().promotion).toBeNull();
    expect(store.getState().records.filter((r) => r.id === "s1")).toHaveLength(1);
  });

  it("treats an unreachable server as offline, not as an empty career", async () => {
    const failing: CareerRepository = { load: () => Promise.reject(new Error("boom")), save: () => Promise.resolve() };
    const store = createCareerStore(failing, { source: "cloud" });
    await store.load();
    expect(store.getState()).toMatchObject({ status: "ready", loadStatus: "offline", earnedXp: 0 });
  });
});
