import { describe, expect, it } from "vitest";
import { CAREER_SCHEMA_VERSION, migrate, parseCareerSave, parseRecord } from "./schema";
import { resultInput } from "./test-fixtures";

const record = (id: string, overrides = {}) => ({ ...resultInput(), id, xpAwarded: 35, ...overrides });
const saveText = (records: unknown[], version: number = CAREER_SCHEMA_VERSION) => JSON.stringify({ version, records });

describe("career save schema", () => {
  it("round-trips a valid save", () => {
    const parsed = parseCareerSave(saveText([record("a"), record("b")]));
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.save.records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(parsed.droppedRecords).toBe(0);
  });

  it("treats unreadable data as corrupt", () => {
    expect(parseCareerSave("{not json").kind).toBe("corrupt");
    expect(parseCareerSave("[]").kind).toBe("corrupt");
    expect(parseCareerSave(JSON.stringify({ records: [] })).kind).toBe("corrupt");
    expect(parseCareerSave(JSON.stringify({ version: 1, records: "nope" })).kind).toBe("corrupt");
  });

  it("drops invalid and duplicate records but keeps the rest", () => {
    const parsed = parseCareerSave(
      saveText([
        record("good"),
        record("bad-score", { score: -5 }),
        record("bad-accuracy", { accuracy: 1.5 }),
        record("bad-game", { gameId: "solitaire" }),
        record("bad-date", { completedAt: "yesterday-ish" }),
        record("bad-fixed", { errorsFixed: 9 }),
        record("good"),
        "garbage",
      ]),
    );
    expect(parsed.kind === "ok" && parsed.save.records.map((r) => r.id)).toEqual(["good"]);
    expect(parsed.kind === "ok" && parsed.droppedRecords).toBe(7);
  });

  it("refuses data from a newer schema version", () => {
    expect(parseCareerSave(saveText([], CAREER_SCHEMA_VERSION + 1))).toEqual({ kind: "unsupportedVersion", version: 2 });
  });

  it("strips unknown fields such as answer keys", () => {
    const parsed = parseRecord(record("a", { solution: "=D4*E4", answerKey: ["secret"] }));
    expect(parsed).not.toHaveProperty("solution");
    expect(parsed).not.toHaveProperty("answerKey");
  });

  it("migrates older versions step by step and fails safely when a step is missing", () => {
    const migrations = { 0: (data: Record<string, unknown>) => ({ ...data, records: data.history, version: 1 }) };
    expect(migrate({ version: 0, history: [] }, 0, migrations)).toEqual({ version: 1, history: [], records: [] });
    expect(migrate({ version: 0 }, 0, {})).toBeNull();
    expect(parseCareerSave(JSON.stringify({ version: 0, history: [record("old")] }), migrations).kind).toBe("corrupt");
    expect(parseCareerSave(JSON.stringify({ version: 0.5, records: [] })).kind).toBe("corrupt");
  });
});
