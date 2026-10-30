/**
 * Request Assistance: one hint per Reconciliation Rush round.
 *
 * The hint points at one planted discrepancy that is still unresolved in the
 * player's current sheet, naming the row and the source document to check.
 * Messages are built only from row numbers, document numbers and fixed
 * wording per variant, so they never contain a corrected value or formula.
 *
 * Pure: like validation, this can move to a server unchanged.
 */
import { cellKey } from "../sheet";
import { COL } from "./generate";
import { hashSeed } from "./rng";
import type { Challenge, ErrorVariant, PlantedError } from "./types";
import { evaluateRound, type PlayerEntries } from "./validate";

export const HINTS_PER_ROUND = 1;

export interface RoundHint {
  /** Planted error the hint points at; null when nothing was left to flag. */
  errorId: string | null;
  /** Zero-based sheet row to check; null when nothing was left to flag. */
  row: number | null;
  documentNumber: string | null;
  message: string;
  /** Milliseconds into the round when assistance was requested. */
  requestedAtMs: number;
}

const FIELD_NAMES: Record<number, string> = {
  [COL.qty]: "quantity",
  [COL.price]: "unit price",
  [COL.amount]: "amount",
};

type HintContext = { row: number; field: string; doc: string; summaryLabel: string };

/** One line per variant. Only {row}, {doc}, field names and labels may vary. */
const MESSAGES: Record<ErrorVariant, (c: HintContext) => string> = {
  transposedDigits: (c) => `Row ${c.row}: the ${c.field} looks like it was typed in a hurry. Compare it digit by digit with ${c.doc}.`,
  extraZero: (c) => `Row ${c.row}: the ${c.field} looks out of proportion. Check its magnitude against ${c.doc}.`,
  missingZero: (c) => `Row ${c.row}: the ${c.field} looks out of proportion. Check its magnitude against ${c.doc}.`,
  decimalShift: (c) => `Row ${c.row}: the ${c.field} looks out of proportion. Check where the decimal point belongs on ${c.doc}.`,
  wrongSign: (c) => `Row ${c.row}: the ${c.field} doesn't look like anything a vendor would bill. Check it against ${c.doc}.`,
  offByOneUnit: (c) => `Row ${c.row}: the amount doesn't look calculated. Check it against quantity × unit price and ${c.doc}.`,
  transposedResult: (c) => `Row ${c.row}: the amount doesn't look calculated. Check it against quantity × unit price and ${c.doc}.`,
  staleSubtotal: (c) => `Row ${c.row} (${c.summaryLabel}) may not include every line item. ${c.doc} explains how it should be built.`,
  wrongRange: (c) => `Row ${c.row} (${c.summaryLabel}): inspect which rows its formula covers. ${c.doc} explains what it should include.`,
  wrongReference: (c) => `Row ${c.row}: the amount formula may be reading from another row. Compare it with ${c.doc}.`,
  wrongOperator: (c) => `Row ${c.row}: the amount formula isn't doing the arithmetic the memo describes. Compare it with ${c.doc}.`,
  wrongTaxBase: (c) => `Row ${c.row} (${c.summaryLabel}): check what the rate is applied to. ${c.doc} spells it out.`,
  wrongTotalOperator: (c) => `Row ${c.row} (${c.summaryLabel}): check how its parts are combined. ${c.doc} spells it out.`,
  listPriceRecorded: (c) => `Row ${c.row}: ${c.doc} has contract pricing terms. Make sure the recorded unit price is what's actually payable.`,
  originalQuantityRecorded: (c) => `Row ${c.row}: ${c.doc} was revised after it was issued. Check which quantity is current.`,
  orderedNotDelivered: (c) => `Row ${c.row}: not everything on ${c.doc} arrived. Check what was actually billed.`,
  rejectedExpenseIncluded: (c) => `Row ${c.row}: ${c.doc} wasn't approved in full. Check which total was approved.`,
};

export const NOTHING_TO_FLAG_MESSAGE =
  "We reviewed your sheet and have nothing left to flag. If you agree, submit before the board starts asking questions.";

/** Planted errors that are not correctly resolved in the current sheet (missed or wrongly fixed). */
export function unresolvedErrors(challenge: Challenge, entries: PlayerEntries): PlantedError[] {
  return evaluateRound(challenge, entries)
    .errors.filter((outcome) => outcome.status !== "fixed")
    .map((outcome) => outcome.error);
}

/** Picks an unresolved error. Deterministic for a seed and sheet state, but not always the first one. */
export function selectHintTarget(challenge: Challenge, entries: PlayerEntries): PlantedError | null {
  const candidates = unresolvedErrors(challenge, entries);
  if (candidates.length === 0) return null;
  return candidates[hashSeed(`${challenge.seed}:hint`) % candidates.length];
}

/** Builds the Finance Operations message for an error. */
export function describeHint(challenge: Challenge, error: PlantedError): string {
  const doc = challenge.documents.find((d) => d.id === error.documentId);
  const summaryLabel = challenge.cells.get(cellKey({ row: error.address.row, col: COL.price }))?.solution ?? "summary";
  return MESSAGES[error.variant]({
    row: error.address.row + 1,
    field: FIELD_NAMES[error.address.col] ?? "value",
    doc: doc?.kind === "memo" ? `the reconciliation memo (${doc.number})` : (doc?.number ?? "the source documents"),
    // Drop the "(8.25%)" rate suffix: hints never contain figures.
    summaryLabel: summaryLabel.replace(/\s*\(.*\)\s*$/, "").toLowerCase(),
  });
}

export function createHint(challenge: Challenge, entries: PlayerEntries, requestedAtMs: number): RoundHint {
  const target = selectHintTarget(challenge, entries);
  if (!target) {
    return { errorId: null, row: null, documentNumber: null, message: NOTHING_TO_FLAG_MESSAGE, requestedAtMs };
  }
  const doc = challenge.documents.find((d) => d.id === target.documentId);
  return {
    errorId: target.id,
    row: target.address.row,
    documentNumber: doc?.number ?? null,
    message: describeHint(challenge, target),
    requestedAtMs,
  };
}
