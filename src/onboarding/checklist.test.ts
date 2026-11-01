import { describe, expect, it } from "vitest";
import { APP_IDS, type AppId } from "@/types/app";
import { VISITED_APPS_STORAGE_KEY, onboardingMilestones, readVisited, writeVisited } from "./checklist";

const done = (input: Parameters<typeof onboardingMilestones>[0]) =>
  Object.fromEntries(onboardingMilestones(input).map((m) => [m.id, m.done]));

describe("onboarding checklist", () => {
  it("lists the four discovery milestones, nothing pre-ticked", () => {
    const milestones = onboardingMilestones({ records: 0, hasDepartment: false, visited: new Set() });
    expect(milestones.map((m) => m.label)).toEqual([
      "Complete your first assignment",
      "Explore your career",
      "Choose a department",
      "Visit the Company dashboard",
    ]);
    expect(milestones.every((m) => !m.done)).toBe(true);
  });

  it("ticks milestones only from real actions", () => {
    expect(done({ records: 1, hasDepartment: false, visited: new Set() })).toEqual({ "first-assignment": true, career: false, department: false, company: false });
    expect(done({ records: 0, hasDepartment: true, visited: new Set<AppId>(["career", "company"]) })).toEqual({ "first-assignment": false, career: true, department: true, company: true });
    // Opening the game isn't completing an assignment.
    expect(done({ records: 0, hasDepartment: false, visited: new Set<AppId>(["spreadsheet-wars", "departments"]) })["first-assignment"]).toBe(false);
  });

  it("persists visited apps and ignores unknown or corrupt values", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    writeVisited(storage, new Set<AppId>(["career", "company"]));
    expect(readVisited(storage, APP_IDS)).toEqual(new Set(["career", "company"]));
    data.set(VISITED_APPS_STORAGE_KEY, '["career","not-an-app",3]');
    expect(readVisited(storage, APP_IDS)).toEqual(new Set(["career"]));
    data.set(VISITED_APPS_STORAGE_KEY, "{");
    expect(readVisited(storage, APP_IDS)).toEqual(new Set());
    expect(readVisited(null, APP_IDS)).toEqual(new Set());
    expect(() => writeVisited({ setItem: () => { throw new Error("blocked"); } }, new Set())).not.toThrow();
  });
});
