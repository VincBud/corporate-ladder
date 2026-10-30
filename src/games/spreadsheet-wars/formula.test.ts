import { describe, expect, it } from "vitest";
import { evaluateCell, normalizeContent, parseAddress, parseFormula, parseLiteral, type SheetSource } from "./formula";
import { cellKey } from "./sheet";

function sheet(contents: Record<string, string>, rowCount = 20, colCount = 8): SheetSource {
  const byKey = new Map(Object.entries(contents).map(([label, content]) => [cellKey(parseAddress(label)!), content]));
  return { rowCount, colCount, getContent: (a) => byKey.get(cellKey(a)) };
}
const value = (source: SheetSource, label: string) => evaluateCell(source, parseAddress(label)!);

describe("formula engine", () => {
  it("parses addresses", () => {
    expect(parseAddress("A1")).toEqual({ row: 0, col: 0 });
    expect(parseAddress("f12")).toEqual({ row: 11, col: 5 });
    expect(parseAddress("$B$3")).toEqual({ row: 2, col: 1 });
    expect(parseAddress("AA10")).toEqual({ row: 9, col: 26 });
    expect(parseAddress("A0")).toBeNull();
    expect(parseAddress("1A")).toBeNull();
  });

  it("evaluates arithmetic with precedence, parentheses and unary minus", () => {
    const s = sheet({ A1: "=1+2*3", A2: "=(1+2)*3", A3: "=-4+10/4", A4: "=2*-3", A5: "= 7 - 2 - 1" });
    expect(value(s, "A1")).toEqual({ kind: "number", value: 7 });
    expect(value(s, "A2")).toEqual({ kind: "number", value: 9 });
    expect(value(s, "A3")).toEqual({ kind: "number", value: -1.5 });
    expect(value(s, "A4")).toEqual({ kind: "number", value: -6 });
    expect(value(s, "A5")).toEqual({ kind: "number", value: 4 });
  });

  it("resolves references and SUM over ranges, ignoring text and blanks", () => {
    const s = sheet({ A1: "10", A2: "2.5", A3: "label", A5: "4", B1: "=A1*A2", B2: "=SUM(A1:A5)", B3: "=sum(A1:A2, 3, B1)" });
    expect(value(s, "B1")).toEqual({ kind: "number", value: 25 });
    expect(value(s, "B2")).toEqual({ kind: "number", value: 16.5 });
    expect(value(s, "B3")).toEqual({ kind: "number", value: 40.5 });
  });

  it("treats empty references as zero and text references as #VALUE!", () => {
    const s = sheet({ A1: "hello", B1: "=A1+1", B2: "=C9+1" });
    expect(value(s, "B1")).toEqual({ kind: "error", error: "#VALUE!" });
    expect(value(s, "B2")).toEqual({ kind: "number", value: 1 });
  });

  it("fails safely on invalid input instead of throwing", () => {
    const cases: Record<string, string> = {
      A1: "=",
      A2: "=1+",
      A3: "=SUM(A1:)",
      A4: "=alert(1)",
      A5: "=constructor.constructor('x')()",
      A6: "=1;2",
      A7: "=A1:A3",
      A8: "=((((1)",
      A9: `=${"(".repeat(200)}1${")".repeat(200)}`,
      A10: `=${"1+".repeat(300)}1`,
    };
    const s = sheet(cases);
    for (const label of Object.keys(cases)) {
      const result = value(s, label);
      expect(result.kind, label).toBe("error");
    }
    expect(value(s, "A4")).toEqual({ kind: "error", error: "#NAME?" });
  });

  it("detects division by zero, out-of-sheet references and cycles", () => {
    const s = sheet({ A1: "=1/0", A2: "=Z99", A3: "=A4+1", A4: "=A3+1", A5: "=A5" }, 20, 8);
    expect(value(s, "A1")).toEqual({ kind: "error", error: "#DIV/0!" });
    expect(value(s, "A2")).toEqual({ kind: "error", error: "#REF!" });
    expect(value(s, "A3")).toEqual({ kind: "error", error: "#CYCLE!" });
    expect(value(s, "A5")).toEqual({ kind: "error", error: "#CYCLE!" });
  });

  it("rejects oversized ranges", () => {
    const s = sheet({ A1: "=SUM(A2:ZZ9999)" }, 99999, 702);
    expect(value(s, "A1")).toEqual({ kind: "error", error: "#REF!" });
  });

  it("parses literals leniently", () => {
    expect(parseLiteral("1,234.50")).toEqual({ kind: "number", value: 1234.5 });
    expect(parseLiteral(" $45 ")).toEqual({ kind: "number", value: 45 });
    expect(parseLiteral("-12")).toEqual({ kind: "number", value: -12 });
    expect(parseLiteral("")).toEqual({ kind: "empty" });
    expect(parseLiteral("12 units")).toEqual({ kind: "text", value: "12 units" });
  });

  it("normalizes content for change detection", () => {
    expect(normalizeContent("45")).toBe(normalizeContent("45.00"));
    expect(normalizeContent("1,200")).toBe(normalizeContent("1200"));
    expect(normalizeContent("=d2 * e2")).toBe(normalizeContent("=D2*E2"));
    expect(normalizeContent("=D2*E2")).not.toBe(normalizeContent("=D2*E3"));
  });

  it("returns parse errors for overly long formulas", () => {
    expect(parseFormula("1+".repeat(200) + "1")).toEqual({ ok: false, error: "#PARSE!" });
  });
});
