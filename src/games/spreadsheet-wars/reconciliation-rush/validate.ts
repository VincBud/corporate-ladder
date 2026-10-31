/**
 * Answer validation. Scores the final committed sheet, never keystrokes.
 *
 * Each editable cell is judged in isolation: the player's content for that
 * cell is evaluated inside an otherwise-correct sheet. A fixed formula is
 * therefore credited even if a different row is still wrong, and one mistake
 * is never counted twice.
 *
 * Pure: a future server can run the same code against submitted entries.
 */
import { evaluateCell, normalizeContent, type CellValue } from "../formula";
import { cellKey, type CellAddress } from "../sheet";
import { solutionSource, valuesMatch, withOverride } from "./generate";
import type { PublicChallenge } from "./public";
import type { Challenge, PlantedError } from "./types";

/** Committed player contents keyed by cellKey. Cells not present keep their initial content. */
export type PlayerEntries = Readonly<Record<string, string>>;

export type ErrorStatus = "fixed" | "missed" | "incorrect";

export interface ErrorOutcome {
  error: PlantedError;
  status: ErrorStatus;
  shownContent: string;
  playerContent: string;
  correctContent: string;
  playerValue: CellValue;
  correctValue: CellValue;
}

/** A cell that was correct at the start and is incorrect after the player's edit. */
export interface CollateralChange {
  address: CellAddress;
  originalContent: string;
  playerContent: string;
  playerValue: CellValue;
  correctValue: CellValue;
}

export interface RoundEvaluation {
  errors: ErrorOutcome[];
  collateral: CollateralChange[];
  fixedCount: number;
  /** Incorrect corrections: wrong edits to planted errors plus broken correct cells. */
  incorrectCount: number;
  /** Distinct cells whose committed content differs from the start. */
  editedCount: number;
}

/** Works with full or public challenges: only initial contents are read. */
export function contentAt(challenge: Pick<PublicChallenge, "cells">, entries: PlayerEntries, address: CellAddress): string {
  const key = cellKey(address);
  return entries[key] ?? challenge.cells.get(key)?.initial ?? "";
}

export function isEdited(challenge: Pick<PublicChallenge, "cells">, entries: PlayerEntries, address: CellAddress): boolean {
  const cell = challenge.cells.get(cellKey(address));
  if (!cell) return false;
  return normalizeContent(contentAt(challenge, entries, address)) !== normalizeContent(cell.initial);
}

export function evaluateRound(challenge: Challenge, entries: PlayerEntries): RoundEvaluation {
  const solution = solutionSource(challenge);
  const errorsByKey = new Map(challenge.errors.map((e) => [cellKey(e.address), e]));
  const errors: ErrorOutcome[] = [];
  const collateral: CollateralChange[] = [];
  let editedCount = 0;

  for (const cell of challenge.cells.values()) {
    if (!cell.editable) continue;
    const playerContent = contentAt(challenge, entries, cell.address);
    const changed = normalizeContent(playerContent) !== normalizeContent(cell.initial);
    if (changed) editedCount++;

    const correctValue = evaluateCell(solution, cell.address);
    const playerValue = evaluateCell(withOverride(solution, cell.address, playerContent), cell.address);
    const correct = valuesMatch(playerValue, correctValue);

    const error = errorsByKey.get(cellKey(cell.address));
    if (error) {
      errors.push({
        error,
        status: correct ? "fixed" : changed ? "incorrect" : "missed",
        shownContent: cell.initial,
        playerContent,
        correctContent: cell.solution,
        playerValue,
        correctValue,
      });
    } else if (changed && !correct) {
      collateral.push({ address: cell.address, originalContent: cell.initial, playerContent, playerValue, correctValue });
    }
  }

  errors.sort((a, b) => a.error.id.localeCompare(b.error.id));
  const fixedCount = errors.filter((e) => e.status === "fixed").length;
  const incorrectCount = errors.filter((e) => e.status === "incorrect").length + collateral.length;
  return { errors, collateral, fixedCount, incorrectCount, editedCount };
}
