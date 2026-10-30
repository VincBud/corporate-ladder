import type { CellAddress } from "../sheet";

export type ErrorCategory = "dataEntry" | "calculation" | "formula" | "reconciliation";
export type Difficulty = "easy" | "medium" | "hard";

export type ErrorVariant =
  // Data entry
  | "transposedDigits"
  | "extraZero"
  | "missingZero"
  | "wrongSign"
  | "decimalShift"
  // Calculation
  | "offByOneUnit"
  | "transposedResult"
  | "staleSubtotal"
  // Formula
  | "wrongRange"
  | "wrongReference"
  | "wrongOperator"
  | "wrongTaxBase"
  | "wrongTotalOperator"
  // Reconciliation
  | "listPriceRecorded"
  | "originalQuantityRecorded"
  | "orderedNotDelivered"
  | "rejectedExpenseIncluded";

export type CellFormat = "text" | "integer" | "currency";
export type CellRole = "header" | "text" | "label" | "input" | "computed" | "blank";

export interface ChallengeCell {
  address: CellAddress;
  role: CellRole;
  format: CellFormat;
  editable: boolean;
  /** Content shown when the round starts; may contain a planted error. */
  initial: string;
  /** Correct content. Must never be rendered while a round is in progress. */
  solution: string;
}

export type DocumentKind = "invoice" | "purchaseOrder" | "expenseReport" | "memo";

export interface DocumentLine {
  label: string;
  value: string;
  /** "final" marks the figure to record; "struck"/"muted" are superseded or informational. */
  tone?: "muted" | "struck" | "final";
}

export interface SourceDocument {
  id: string;
  kind: DocumentKind;
  number: string;
  title: string;
  issuer: string;
  date: string;
  /** Zero-based sheet row this document supports; null for general memos. */
  row: number | null;
  subject: string;
  lines: DocumentLine[];
  stamp?: string;
  footnote?: string;
}

export interface PlantedError {
  id: string;
  address: CellAddress;
  category: ErrorCategory;
  variant: ErrorVariant;
  difficulty: Difficulty;
  /** Document that proves the correct value. */
  documentId: string;
  /** One-line pointer to the proof, e.g. "INV-48213 · Net unit price 44.20". */
  evidence: string;
  /** Post-round explanation of what went wrong. */
  explanation: string;
}

export interface Challenge {
  seed: string;
  templateId: string;
  department: string;
  title: string;
  fileName: string;
  /** Grid dimensions, including empty padding rows/columns. */
  rowCount: number;
  colCount: number;
  /** Rows actually used by the ledger (header to total). */
  ledgerRowCount: number;
  cells: ReadonlyMap<string, ChallengeCell>;
  documents: readonly SourceDocument[];
  errors: readonly PlantedError[];
}
