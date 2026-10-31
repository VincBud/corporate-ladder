import { describe, expect, it } from "vitest";
import { addressLabel, cellKey } from "../sheet";
import { generateChallenge } from "./generate";
import { correctionAccuracy, gradeRound, managerFeedback } from "./report";
import { DIFFICULTY_POINTS, INCORRECT_CORRECTION_PENALTY, MAX_TIME_BONUS, calculateTimeBonus, scoreRound } from "./scoring";
import type { Challenge } from "./types";
import { evaluateRound, type PlayerEntries } from "./validate";

const challenge = generateChallenge("RR-SCORE1");
const DURATION = 90_000;

function solutionEntries(c: Challenge, count = c.errors.length): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const error of c.errors.slice(0, count)) {
    const key = cellKey(error.address);
    entries[key] = c.cells.get(key)!.solution;
  }
  return entries;
}

const basePoints = (c: Challenge, count = c.errors.length) =>
  c.errors.slice(0, count).reduce((sum, e) => sum + DIFFICULTY_POINTS[e.difficulty], 0);

/** First editable, error-free numeric input cell. */
function untouchedInput(c: Challenge) {
  const errorKeys = new Set(c.errors.map((e) => cellKey(e.address)));
  return [...c.cells.values()].find((cell) => cell.role === "input" && !errorKeys.has(cellKey(cell.address)))!;
}

describe("validation and scoring", () => {
  it("scores an untouched sheet as zero with all errors missed", () => {
    const evaluation = evaluateRound(challenge, {});
    expect(evaluation.fixedCount).toBe(0);
    expect(evaluation.errors.every((e) => e.status === "missed")).toBe(true);
    expect(evaluation.incorrectCount).toBe(0);
    expect(scoreRound(evaluation, DURATION, DURATION).total).toBe(0);
    expect(gradeRound(evaluation)).toBe("Schedule a Meeting with HR");
    expect(correctionAccuracy(evaluation)).toBeNull();
  });

  it("awards difficulty points and a proportional time bonus for a perfect round", () => {
    const evaluation = evaluateRound(challenge, solutionEntries(challenge));
    expect(evaluation.fixedCount).toBe(5);
    const score = scoreRound(evaluation, 45_000, DURATION);
    expect(score.timeBonus).toBe(150);
    expect(score.total).toBe(basePoints(challenge) + 150);
    expect(score.maxPossible).toBe(basePoints(challenge) + MAX_TIME_BONUS);
    expect(gradeRound(evaluation)).toBe("Exceeds Expectations");
    expect(correctionAccuracy(evaluation)).toBe(1);
  });

  it("only grants the time bonus when all five errors are fixed", () => {
    const evaluation = evaluateRound(challenge, solutionEntries(challenge, 4));
    const score = scoreRound(evaluation, 80_000, DURATION);
    expect(score.timeBonus).toBe(0);
    expect(score.total).toBe(basePoints(challenge, 4));
    expect(gradeRound(evaluation)).toBe("Meets Expectations");
  });

  it("accepts any equivalent correct answer (value or formula)", () => {
    const formulaError = challenge.errors.find((e) => e.address.col === 5);
    const target = formulaError ?? challenge.errors[0];
    const key = cellKey(target.address);
    const correct = evaluateRound(challenge, solutionEntries(challenge)).errors.find((e) => e.error.id === target.id)!;
    const asValue = correct.correctValue.kind === "number" ? correct.correctValue.value.toFixed(2) : "";
    const evaluation = evaluateRound(challenge, { [key]: asValue });
    expect(evaluation.errors.find((e) => e.error.id === target.id)!.status).toBe("fixed");
  });

  it("penalizes wrong corrections, invalid formulas and broken correct cells", () => {
    const [first, second] = challenge.errors;
    const healthy = untouchedInput(challenge);
    const entries: PlayerEntries = {
      [cellKey(first.address)]: "999999",
      [cellKey(second.address)]: "=SUM(",
      [cellKey(healthy.address)]: "123456",
    };
    const evaluation = evaluateRound(challenge, entries);
    expect(evaluation.errors.find((e) => e.error.id === first.id)!.status).toBe("incorrect");
    expect(evaluation.errors.find((e) => e.error.id === second.id)!.status).toBe("incorrect");
    expect(evaluation.collateral.map((c) => addressLabel(c.address))).toEqual([addressLabel(healthy.address)]);
    expect(evaluation.incorrectCount).toBe(3);
    expect(scoreRound(evaluation, 0, DURATION).penaltyPoints).toBe(-3 * INCORRECT_CORRECTION_PENALTY);
  });

  it("never goes below zero", () => {
    const entries: Record<string, string> = {};
    for (const cell of challenge.cells.values()) if (cell.editable) entries[cellKey(cell.address)] = "-1";
    const score = scoreRound(evaluateRound(challenge, entries), DURATION, DURATION);
    expect(score.total).toBe(0);
  });

  it("does not penalize a correct cell rewritten as an equivalent value", () => {
    const healthy = untouchedInput(challenge);
    const evaluation = evaluateRound(challenge, { [cellKey(healthy.address)]: `${healthy.solution}.000` });
    expect(evaluation.collateral).toHaveLength(0);
    expect(evaluation.editedCount).toBe(0);
  });

  it("scores the final state only, so repeated edits cannot farm points", () => {
    const once = scoreRound(evaluateRound(challenge, solutionEntries(challenge, 1)), 0, DURATION).total;
    // Entries are a map: re-committing a cell replaces it, never accumulates.
    const again = scoreRound(evaluateRound(challenge, { ...solutionEntries(challenge, 1), ...solutionEntries(challenge, 1) }), 0, DURATION).total;
    expect(again).toBe(once);
  });

  it("computes the time bonus at the boundaries", () => {
    expect(calculateTimeBonus(DURATION, DURATION)).toBe(MAX_TIME_BONUS);
    expect(calculateTimeBonus(0, DURATION)).toBe(0);
    expect(calculateTimeBonus(-5, DURATION)).toBe(0);
    expect(calculateTimeBonus(DURATION * 2, DURATION)).toBe(MAX_TIME_BONUS);
    expect(calculateTimeBonus(30_000, DURATION)).toBe(100);
  });

  it("gives deterministic manager feedback", () => {
    expect(managerFeedback("Needs Improvement", "RR-X")).toBe(managerFeedback("Needs Improvement", "RR-X"));
  });

  it("solves every generated challenge with its own solution", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateChallenge(`SOLVE-${i}`);
      const evaluation = evaluateRound(c, solutionEntries(c));
      expect(evaluation.fixedCount, c.seed).toBe(5);
      expect(evaluation.incorrectCount, c.seed).toBe(0);
    }
  });
});
