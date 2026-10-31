import { describe, expect, it } from "vitest";
import { cellKey } from "../sheet";
import { generateChallenge } from "./generate";
import { HINTS_PER_ROUND, NOTHING_TO_FLAG_MESSAGE, createHint, describeHint, selectHintTarget, unresolvedErrors } from "./hints";
import {
  ROUND_DURATION_MS,
  hintsRemaining,
  initialSpreadsheetWarsState,
  spreadsheetWarsReducer as reduce,
  type LocalActiveRound,
  type SpreadsheetWarsState,
} from "./machine";
import type { Challenge, PlantedError } from "./types";
import { evaluateRound } from "./validate";

const T0 = 5_000;
const SEEDS = Array.from({ length: 400 }, (_, i) => `HINT-${i}`);

type Playing = { phase: "playing"; round: LocalActiveRound };

function playing(seed = "RR-HINTS"): Playing {
  const state = reduce(reduce(initialSpreadsheetWarsState, { type: "openBriefing", seed }), { type: "start", now: T0, sessionId: "test-session" });
  if (state.phase !== "playing" || state.round.mode !== "local") throw new Error("expected a local round");
  return { phase: "playing", round: state.round };
}

const fix = (challenge: Challenge, errors: readonly PlantedError[]) =>
  Object.fromEntries(errors.map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]));

/**
 * A hint may mention the row number and document number. Once those are
 * removed, no digits or formula syntax may remain, so no value, formula or
 * cell reference from the answer key can leak.
 */
function assertNoAnswerLeak(challenge: Challenge, error: PlantedError, message: string) {
  const doc = challenge.documents.find((d) => d.id === error.documentId)!;
  const stripped = message.replaceAll(doc.number, "").replace(new RegExp(`\\b${error.address.row + 1}\\b`, "g"), "");
  expect(stripped, message).not.toMatch(/\d/);
  expect(message).not.toContain("=");
  expect(message).toContain(`Row ${error.address.row + 1}`);
  expect(message).toContain(doc.number);
}

describe("hint content", () => {
  it("covers every discrepancy category and variant without leaking answers", () => {
    const variants = new Set<string>();
    const categories = new Set<string>();
    for (const seed of SEEDS) {
      const challenge = generateChallenge(seed);
      for (const error of challenge.errors) {
        assertNoAnswerLeak(challenge, error, describeHint(challenge, error));
        variants.add(error.variant);
        categories.add(error.category);
      }
    }
    expect(categories.size).toBe(4);
    expect(variants.size).toBe(17);
  });

  it("does not contain the shown or correct content of the target cell", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const challenge = generateChallenge(seed);
      for (const error of challenge.errors) {
        const cell = challenge.cells.get(cellKey(error.address))!;
        const doc = challenge.documents.find((d) => d.id === error.documentId)!;
        // Short values like "9" can appear inside a document number, so compare
        // against the message with the allowed identifiers removed.
        const message = describeHint(challenge, error)
          .replaceAll(doc.number, "")
          .replace(`Row ${error.address.row + 1}`, "");
        expect(message).not.toContain(cell.solution);
        expect(message).not.toContain(cell.initial);
      }
    }
  });

  it("is deterministic for a seed and sheet state", () => {
    const challenge = generateChallenge("RR-DETERMINISTIC");
    expect(createHint(challenge, {}, 1_000)).toEqual(createHint(challenge, {}, 1_000));
  });
});

describe("hint target selection", () => {
  it("targets an unresolved planted error on an untouched sheet", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const challenge = generateChallenge(seed);
      const target = selectHintTarget(challenge, {});
      expect(challenge.errors).toContain(target);
    }
  });

  it("never points at an error that is already correctly resolved", () => {
    for (const seed of SEEDS) {
      const challenge = generateChallenge(seed);
      // Fix a seed-dependent subset of 0–4 errors.
      const fixedCount = seed.length % 5;
      const fixed = challenge.errors.slice(0, fixedCount);
      const entries = fix(challenge, fixed);
      const hint = createHint(challenge, entries, 0);
      expect(hint.errorId, seed).not.toBeNull();
      expect(fixed.map((e) => e.id), seed).not.toContain(hint.errorId);
      const status = evaluateRound(challenge, entries).errors.find((o) => o.error.id === hint.errorId)!.status;
      expect(status).not.toBe("fixed");
    }
  });

  it("points at the only remaining error when four are fixed", () => {
    const challenge = generateChallenge("RR-LASTONE");
    for (let skip = 0; skip < challenge.errors.length; skip++) {
      const fixed = challenge.errors.filter((_, i) => i !== skip);
      const hint = createHint(challenge, fix(challenge, fixed), 0);
      expect(hint.errorId).toBe(challenge.errors[skip].id);
      expect(hint.row).toBe(challenge.errors[skip].address.row);
    }
  });

  it("still targets errors that were changed but fixed incorrectly", () => {
    const challenge = generateChallenge("RR-WRONGFIX");
    const [wrong, ...rest] = challenge.errors;
    const entries = { ...fix(challenge, rest), [cellKey(wrong.address)]: "987654" };
    expect(unresolvedErrors(challenge, entries).map((e) => e.id)).toEqual([wrong.id]);
    expect(createHint(challenge, entries, 0).errorId).toBe(wrong.id);
  });

  it("reports nothing to flag when every error is resolved", () => {
    const challenge = generateChallenge("RR-ALLDONE");
    const hint = createHint(challenge, fix(challenge, challenge.errors), 12_000);
    expect(hint).toEqual({ errorId: null, row: null, documentNumber: null, message: NOTHING_TO_FLAG_MESSAGE, requestedAtMs: 12_000 });
  });
});

describe("hint state machine", () => {
  it("allows exactly one hint per round", () => {
    const start = playing();
    expect(hintsRemaining(start.round)).toBe(HINTS_PER_ROUND);
    const first = reduce(start, { type: "requestHint", now: T0 + 1_000 });
    expect(first.phase === "playing" && first.round.hint?.requestedAtMs).toBe(1_000);
    expect(first.phase === "playing" && hintsRemaining(first.round)).toBe(0);
    const second = reduce(first, { type: "requestHint", now: T0 + 2_000 });
    expect(second).toBe(first);
  });

  it("keeps the first hint even if the sheet changes afterwards", () => {
    const start = playing();
    const { challenge } = start.round;
    const first = reduce(start, { type: "requestHint", now: T0 + 1_000 });
    if (first.phase !== "playing") throw new Error();
    const target = challenge.errors.find((e) => e.id === first.round.hint!.errorId)!;
    const solution = challenge.cells.get(cellKey(target.address))!.solution;
    const after = reduce(first, { type: "commitCell", address: target.address, content: solution, now: T0 + 2_000 });
    expect(after.phase === "playing" && after.round.hint).toEqual(first.round.hint);
    expect(reduce(after, { type: "requestHint", now: T0 + 3_000 })).toBe(after);
  });

  it("is unavailable outside an active round", () => {
    const lobby = initialSpreadsheetWarsState;
    expect(reduce(lobby, { type: "requestHint", now: T0 })).toBe(lobby);
    const briefing = reduce(lobby, { type: "openBriefing", seed: "RR-BRIEF" });
    expect(reduce(briefing, { type: "requestHint", now: T0 })).toBe(briefing);
    const results = reduce(playing(), { type: "submit", now: T0 + 10_000 });
    expect(reduce(results, { type: "requestHint", now: T0 + 11_000 })).toBe(results);
    const review = reduce(results, { type: "openReview" });
    expect(reduce(review, { type: "requestHint", now: T0 + 12_000 })).toBe(review);
  });

  it("does not pause, extend or reset the clock", () => {
    const start = playing();
    const hinted = reduce(start, { type: "requestHint", now: T0 + 30_000 });
    if (hinted.phase !== "playing") throw new Error();
    expect(hinted.round.startedAt).toBe(start.round.startedAt);
    expect(hinted.round.durationMs).toBe(ROUND_DURATION_MS);
    const timedOut = reduce(hinted, { type: "tick", now: T0 + ROUND_DURATION_MS });
    expect(timedOut.phase === "results" && timedOut.round.outcome).toBe("timedOut");
  });

  it("finalizes as a timeout instead of granting a hint after the deadline", () => {
    const late = reduce(playing(), { type: "requestHint", now: T0 + ROUND_DURATION_MS });
    expect(late.phase).toBe("results");
    if (late.phase !== "results") return;
    expect(late.round.outcome).toBe("timedOut");
    expect(late.round.hint).toBeNull();
    expect(late.round.assistanceUsed).toBe(false);
  });

  it("records assistance in results without changing the score", () => {
    const plain = playing("RR-SAMESCORE");
    const hinted = reduce(plain, { type: "requestHint", now: T0 + 5_000 });
    const withHint = reduce(hinted, { type: "submit", now: T0 + 20_000 });
    const withoutHint = reduce(plain, { type: "submit", now: T0 + 20_000 });
    if (withHint.phase !== "results" || withoutHint.phase !== "results") throw new Error();
    expect(withHint.round.assistanceUsed).toBe(true);
    expect(withoutHint.round.assistanceUsed).toBe(false);
    expect(withHint.round.score).toEqual(withoutHint.round.score);
    expect(withHint.round.grade).toBe(withoutHint.round.grade);
  });

  it("records assistance on timed-out rounds too", () => {
    const hinted = reduce(playing(), { type: "requestHint", now: T0 + 1_000 });
    const timedOut = reduce(hinted, { type: "tick", now: T0 + ROUND_DURATION_MS + 50 });
    expect(timedOut.phase === "results" && timedOut.round.assistanceUsed).toBe(true);
  });

  it("resets for every new round", () => {
    const used = reduce(reduce(playing(), { type: "requestHint", now: T0 + 1_000 }), { type: "submit", now: T0 + 2_000 });
    const again = reduce(reduce(used, { type: "openBriefing", seed: "RR-NEXT" }), { type: "start", now: T0 + 10_000, sessionId: "test-session" });
    expect(again.phase).toBe("playing");
    if (again.phase !== "playing") return;
    expect(again.round.hint).toBeNull();
    expect(hintsRemaining(again.round)).toBe(1);
    const hinted = reduce(again, { type: "requestHint", now: T0 + 11_000 });
    expect(hinted.phase === "playing" && hinted.round.hint).not.toBeNull();
  });

  it("produces a valid hint at any point of a round for many seeds", () => {
    for (const seed of SEEDS.slice(0, 150)) {
      const start = playing(seed);
      const { challenge } = start.round;
      let state: SpreadsheetWarsState = start;
      // Resolve a couple of errors first, as a player might.
      for (const error of challenge.errors.slice(0, 2)) {
        state = reduce(state, { type: "commitCell", address: error.address, content: challenge.cells.get(cellKey(error.address))!.solution, now: T0 + 1 });
      }
      state = reduce(state, { type: "requestHint", now: T0 + 2 });
      if (state.phase !== "playing") throw new Error();
      const hint = state.round.hint!;
      const target = challenge.errors.find((e) => e.id === hint.errorId)!;
      expect(challenge.errors.slice(0, 2)).not.toContain(target);
      assertNoAnswerLeak(challenge, target, hint.message);
    }
  });
});
