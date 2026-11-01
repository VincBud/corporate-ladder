import { beforeEach, describe, expect, it } from "vitest";
import type { AchievementUnlock } from "@/types/achievements";
import { currentAchievementToast, dismissAchievementToast, enqueueAchievementToasts, resetAchievementToasts } from "./toast-queue";

const unlock = (id: AchievementUnlock["id"]): AchievementUnlock => ({ id, unlockedAt: "2026-11-01T10:00:00.000Z" });

beforeEach(() => resetAchievementToasts());

describe("achievement toast queue", () => {
  it("shows unlocks one at a time, in order", () => {
    expect(currentAchievementToast()).toBeNull();
    enqueueAchievementToasts([unlock("first-assignment"), unlock("clean-audit")]);
    expect(currentAchievementToast()?.id).toBe("first-assignment");
    dismissAchievementToast();
    expect(currentAchievementToast()?.id).toBe("clean-audit");
    dismissAchievementToast();
    expect(currentAchievementToast()).toBeNull();
  });

  it("never queues or repeats the same unlock twice (retried responses, duplicate reports)", () => {
    enqueueAchievementToasts([unlock("first-assignment")]);
    enqueueAchievementToasts([unlock("first-assignment"), unlock("team-player")]);
    dismissAchievementToast();
    enqueueAchievementToasts([unlock("first-assignment")]);
    expect(currentAchievementToast()?.id).toBe("team-player");
    dismissAchievementToast();
    expect(currentAchievementToast()).toBeNull();
  });

  it("ignores empty and missing reports", () => {
    enqueueAchievementToasts(undefined);
    enqueueAchievementToasts(null);
    enqueueAchievementToasts([]);
    expect(currentAchievementToast()).toBeNull();
  });
});
