import { describe, expect, it } from "vitest";
import { evaluateCell } from "../formula";
import { cellKey } from "../sheet";
import {
  COL,
  ERRORS_PER_ROUND,
  createSeed,
  findIntegrityProblems,
  formatMoney,
  generateChallenge,
  solutionSource,
} from "./generate";
import { TEMPLATES } from "./templates";

const SEEDS = Array.from({ length: 1000 }, (_, i) => `TEST-${i}`);

function snapshot(seed: string) {
  const c = generateChallenge(seed);
  return {
    template: c.templateId,
    cells: [...c.cells.values()].map((cell) => [cell.address, cell.initial, cell.solution]),
    docs: c.documents,
    errors: c.errors,
  };
}

describe("challenge generation", () => {
  it("is deterministic for a seed", () => {
    expect(snapshot("RR-ABC123")).toEqual(snapshot("RR-ABC123"));
  });

  it("produces different challenges for different seeds", () => {
    const a = snapshot("RR-AAAAAA");
    const b = snapshot("RR-BBBBBB");
    expect(a).not.toEqual(b);
  });

  it("satisfies every integrity rule across many seeds", () => {
    for (const seed of SEEDS) {
      const challenge = generateChallenge(seed);
      expect(findIntegrityProblems(challenge), seed).toEqual([]);
      expect(challenge.errors).toHaveLength(ERRORS_PER_ROUND);
      expect(challenge.ledgerRowCount).toBeGreaterThanOrEqual(12);
      expect(challenge.ledgerRowCount).toBeLessThanOrEqual(20);
      expect(new Set(challenge.errors.map((e) => e.category)).size).toBe(4);
    }
  });

  it("uses every template and a wide range of variants", () => {
    const templates = new Set<string>();
    const variants = new Set<string>();
    for (const seed of SEEDS) {
      const challenge = generateChallenge(seed);
      templates.add(challenge.templateId);
      challenge.errors.forEach((e) => variants.add(e.variant));
    }
    expect(templates.size).toBe(TEMPLATES.length);
    expect(variants.size).toBe(17);
  });

  it("backs every line item with a document that shows its correct figures", () => {
    for (const seed of SEEDS.slice(0, 300)) {
      const challenge = generateChallenge(seed);
      const solution = solutionSource(challenge);
      for (const doc of challenge.documents) {
        if (doc.row === null) continue;
        const qty = challenge.cells.get(cellKey({ row: doc.row, col: COL.qty }))!.solution;
        const priceValue = evaluateCell(solution, { row: doc.row, col: COL.price });
        const price = formatMoney(priceValue.kind === "number" ? priceValue.value : NaN);
        const values = doc.lines.map((line) => line.value);
        if (doc.kind === "expenseReport") {
          expect(qty).toBe("1");
        } else {
          expect(values, `${seed} ${doc.number} qty`).toContain(qty);
        }
        expect(values, `${seed} ${doc.number} price`).toContain(price);
        // A figure marked "final" on a document is always the correct one.
        for (const line of doc.lines.filter((l) => l.tone === "final")) {
          expect([qty, price], `${seed} ${doc.number} final`).toContain(line.value);
        }
        // The Ref column links the row to this document.
        expect(challenge.cells.get(cellKey({ row: doc.row, col: COL.ref }))!.solution).toBe(doc.number);
      }
    }
  });

  it("never shows the correct answer in a planted cell", () => {
    for (const seed of SEEDS.slice(0, 300)) {
      const challenge = generateChallenge(seed);
      for (const error of challenge.errors) {
        const cell = challenge.cells.get(cellKey(error.address))!;
        expect(cell.initial).not.toBe(cell.solution);
        expect(error.explanation.length).toBeGreaterThan(20);
      }
    }
  });

  it("creates readable seeds", () => {
    let i = 0;
    const fake = () => [0.1, 0.5, 0.9, 0.3, 0.7, 0.2][i++ % 6];
    expect(createSeed(fake)).toMatch(/^RR-[A-Z2-9]{6}$/);
  });
});
