import { describe, expect, it } from "vitest";
import { EMPTY_MEMORY, MAX_TEXT_LENGTH, deviceCategoryFor, parseMemory, shouldAutoPromptSurvey, validateSubmission, type AutoPromptInput } from "./survey";

const valid = {
  requestId: "6f1c2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b",
  ratings: { gameplayFun: 7, easeOfUnderstanding: 5, playability: 8, replayAppeal: 6 },
  enjoyed: "  The satire.  ",
  improve: "",
  context: { gamesPlayed: ["pipeline-panic", "reconciliation-rush", "pipeline-panic"], completedRounds: 4, deviceCategory: "desktop" },
};
const prompt = (overrides: Partial<AutoPromptInput> = {}): AutoPromptInput => ({ memory: EMPTY_MEMORY, completedRounds: 3, submittedOnServer: false, blocked: false, ...overrides });

describe("submission validation", () => {
  it("accepts a complete submission and normalizes it", () => {
    const result = validateSubmission(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ enjoyed: "The satire.", improve: null, context: { gamesPlayed: ["pipeline-panic", "reconciliation-rush"], completedRounds: 4 } });
  });

  it("requires all four ratings as whole numbers from 1 to 10", () => {
    for (const bad of [0, 11, 5.5, "7", null, undefined]) {
      expect(validateSubmission({ ...valid, ratings: { ...valid.ratings, playability: bad } }).ok).toBe(false);
    }
    expect(validateSubmission({ ...valid, ratings: undefined }).ok).toBe(false);
  });

  it("limits comments, strips control characters and rejects non-text", () => {
    expect(validateSubmission({ ...valid, improve: "x".repeat(MAX_TEXT_LENGTH + 1) }).ok).toBe(false);
    expect(validateSubmission({ ...valid, improve: { html: "<b>" } }).ok).toBe(false);
    const cleaned = validateSubmission({ ...valid, improve: "line one\nline\u0000 two\u0007" });
    expect(cleaned.ok && cleaned.value.improve).toBe("line one\nline two");
  });

  it("rejects malformed ids and drops unknown context values", () => {
    expect(validateSubmission({ ...valid, requestId: "1" }).ok).toBe(false);
    expect(validateSubmission({ ...valid, guestToken: "not-a-uuid" }).ok).toBe(false);
    expect(validateSubmission([]).ok).toBe(false);
    const odd = validateSubmission({ ...valid, context: { gamesPlayed: ["chess", 3], completedRounds: -5, deviceCategory: "iPhone 17 Pro" } });
    expect(odd.ok && odd.value.context).toEqual({ gamesPlayed: [], completedRounds: 0, deviceCategory: "unknown" });
  });
});

describe("device category", () => {
  it("uses only screen width and pointer type", () => {
    expect(deviceCategoryFor(390, true)).toBe("mobile");
    expect(deviceCategoryFor(820, true)).toBe("tablet");
    expect(deviceCategoryFor(1440, false)).toBe("desktop");
    expect(deviceCategoryFor(Number.NaN, false)).toBe("unknown");
  });
});

describe("automatic prompts", () => {
  it("opens after the third completed round", () => {
    expect(shouldAutoPromptSurvey(prompt({ completedRounds: 2 }))).toBe(false);
    expect(shouldAutoPromptSurvey(prompt({ completedRounds: 3 }))).toBe(true);
    // Existing players with many rounds are eligible once.
    expect(shouldAutoPromptSurvey(prompt({ completedRounds: 40 }))).toBe(true);
  });

  it("never interrupts a round, briefing, result, review or orientation", () => {
    expect(shouldAutoPromptSurvey(prompt({ blocked: true }))).toBe(false);
  });

  it("reminds once, two rounds after a dismissal, then stops", () => {
    const afterFirst = { autoPrompts: 1, lastPromptRounds: 3, submittedAt: null };
    expect(shouldAutoPromptSurvey(prompt({ memory: afterFirst, completedRounds: 4 }))).toBe(false);
    expect(shouldAutoPromptSurvey(prompt({ memory: afterFirst, completedRounds: 5 }))).toBe(true);
    const afterSecond = { autoPrompts: 2, lastPromptRounds: 5, submittedAt: null };
    expect(shouldAutoPromptSurvey(prompt({ memory: afterSecond, completedRounds: 50 }))).toBe(false);
  });

  it("never prompts again after a submission, here or on the account's other devices", () => {
    expect(shouldAutoPromptSurvey(prompt({ memory: { ...EMPTY_MEMORY, submittedAt: "2026-11-01T10:00:00Z" } }))).toBe(false);
    expect(shouldAutoPromptSurvey(prompt({ submittedOnServer: true }))).toBe(false);
  });

  it("doesn't nag when storage is blocked or corrupt", () => {
    expect(shouldAutoPromptSurvey(prompt({ memory: null }))).toBe(false);
    expect(shouldAutoPromptSurvey(prompt({ memory: parseMemory("{oops") }))).toBe(false);
    expect(parseMemory(null)).toEqual(EMPTY_MEMORY);
    expect(parseMemory('{"autoPrompts":1,"lastPromptRounds":3}')).toEqual({ autoPrompts: 1, lastPromptRounds: 3, submittedAt: null });
  });
});
