import { describe, expect, it } from "vitest";
import { ORIENTATION_STORAGE_KEY, readOrientation, shouldAutoShowOrientation, writeOrientation, type AutoShowInput } from "./orientation";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}
const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};
const NEW_PLAYER = { records: 0, legacyRecords: 0, xp: 0, hasDepartment: false };
const input = (overrides: Partial<AutoShowInput> = {}): AutoShowInput => ({
  memory: { available: true, record: null },
  ready: true,
  progress: NEW_PLAYER,
  busy: false,
  ...overrides,
});

describe("orientation memory", () => {
  it("remembers completion and dismissal across reloads (same storage)", () => {
    const storage = memoryStorage();
    expect(readOrientation(storage)).toEqual({ available: true, record: null });
    expect(writeOrientation(storage, "completed", new Date("2026-11-01T10:00:00Z"))).toBe(true);
    expect(readOrientation(storage)).toEqual({ available: true, record: { outcome: "completed", at: "2026-11-01T10:00:00.000Z" } });
    writeOrientation(storage, "dismissed", new Date("2026-11-02T10:00:00Z"));
    expect(readOrientation(storage)).toMatchObject({ record: { outcome: "dismissed" } });
  });

  it("treats blocked or corrupt storage as 'don't nag'", () => {
    expect(readOrientation(null)).toEqual({ available: false });
    expect(readOrientation(throwing)).toEqual({ available: false });
    expect(writeOrientation(throwing, "completed", new Date())).toBe(false);
    expect(readOrientation(memoryStorage({ [ORIENTATION_STORAGE_KEY]: "{not json" }))).toEqual({ available: false });
    // Unknown outcome values still count as seen.
    expect(readOrientation(memoryStorage({ [ORIENTATION_STORAGE_KEY]: '{"outcome":"weird"}' }))).toMatchObject({ record: { outcome: "dismissed" } });
  });
});

describe("first-visit behavior", () => {
  it("opens by itself for a new player on the first visit only", () => {
    expect(shouldAutoShowOrientation(input())).toBe(true);
    expect(shouldAutoShowOrientation(input({ memory: { available: true, record: { outcome: "completed", at: "" } } }))).toBe(false);
    expect(shouldAutoShowOrientation(input({ memory: { available: true, record: { outcome: "dismissed", at: "" } } }))).toBe(false);
  });

  it("waits until auth and career are known, and never opens over a running round", () => {
    expect(shouldAutoShowOrientation(input({ ready: false }))).toBe(false);
    expect(shouldAutoShowOrientation(input({ memory: null }))).toBe(false);
    expect(shouldAutoShowOrientation(input({ busy: true }))).toBe(false);
  });

  it("doesn't interrupt existing players with prior progress", () => {
    expect(shouldAutoShowOrientation(input({ progress: { ...NEW_PLAYER, records: 3 } }))).toBe(false);
    expect(shouldAutoShowOrientation(input({ progress: { ...NEW_PLAYER, xp: 40 } }))).toBe(false);
    expect(shouldAutoShowOrientation(input({ progress: { ...NEW_PLAYER, legacyRecords: 1 } }))).toBe(false);
    expect(shouldAutoShowOrientation(input({ progress: { ...NEW_PLAYER, hasDepartment: true } }))).toBe(false);
  });

  it("is remembered per browser, so a guest who signs up isn't shown it again", () => {
    const storage = memoryStorage();
    writeOrientation(storage, "completed", new Date()); // as a guest
    // Later, signed in to a brand-new account (no progress): still not shown.
    expect(shouldAutoShowOrientation(input({ memory: readOrientation(storage) }))).toBe(false);
  });

  it("never opens by itself when storage is blocked", () => {
    expect(shouldAutoShowOrientation(input({ memory: readOrientation(throwing) }))).toBe(false);
  });
});
