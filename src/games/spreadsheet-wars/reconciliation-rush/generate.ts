/**
 * Seeded Reconciliation Rush challenge generation.
 *
 * 1. Build a fully consistent ledger (line items, formulas, source documents).
 * 2. Pick five error slots covering all four categories, one per row.
 * 3. Give documents their final shape (discounts, revisions, partial
 *    deliveries, expense rejections). Correct rows get these too, so a complex
 *    document is never a giveaway on its own.
 * 4. Corrupt exactly five cells and record the evidence for each.
 *
 * Pure and deterministic: the same seed always yields the same challenge, so
 * a future server can regenerate and validate rounds independently.
 */
import { evaluateCell, normalizeContent, type CellValue, type SheetSource } from "../formula";
import { addressLabel, cellKey, type CellAddress } from "../sheet";
import { createRng, type Rng } from "./rng";
import { REJECTED_EXPENSES, TEMPLATES, type ItemSpec, type LedgerTemplate, type LineDocumentKind } from "./templates";
import type {
  Challenge,
  ChallengeCell,
  Difficulty,
  DocumentLine,
  ErrorCategory,
  ErrorVariant,
  PlantedError,
  SourceDocument,
} from "./types";

export const ERRORS_PER_ROUND = 5;
export const MIN_LINE_ITEMS = 10;
export const MAX_LINE_ITEMS = 13;
const GRID_COLUMNS = 8;
const PADDING_ROWS = 5;
const MAX_ATTEMPTS = 12;

export const COL = { ref: 0, vendor: 1, description: 2, qty: 3, price: 4, amount: 5 } as const;

export const DIFFICULTY: Record<ErrorVariant, Difficulty> = {
  transposedDigits: "easy",
  extraZero: "easy",
  missingZero: "easy",
  wrongSign: "easy",
  decimalShift: "easy",
  offByOneUnit: "easy",
  transposedResult: "easy",
  staleSubtotal: "medium",
  wrongReference: "medium",
  wrongOperator: "medium",
  wrongTaxBase: "medium",
  wrongTotalOperator: "medium",
  wrongRange: "hard",
  listPriceRecorded: "hard",
  originalQuantityRecorded: "hard",
  orderedNotDelivered: "hard",
  rejectedExpenseIncluded: "hard",
};

type Shape =
  | { kind: "standard" }
  | { kind: "discount"; listCents: number; discountPct: number }
  | { kind: "amended"; originalQty: number }
  | { kind: "partial"; orderedQty: number }
  | {
      kind: "expense";
      parts: { label: string; cents: number }[];
      rejected: { label: string; reason: string; cents: number } | null;
    };

interface LineItem {
  row: number;
  spec: ItemSpec;
  docKind: LineDocumentKind;
  docNumber: string;
  date: string;
  qty: number;
  priceCents: number;
  shape: Shape;
}

interface Layout {
  firstItemRow: number;
  lastItemRow: number;
  subtotalRow: number;
  taxRow: number;
  totalRow: number;
  ledgerRowCount: number;
}

type Slot =
  | { category: "dataEntry"; row: number; field: "qty" | "price" }
  | { category: "calculation"; row: number; variant: "offByOneUnit" | "transposedResult" | "staleSubtotal" }
  | {
      category: "formula";
      row: number;
      variant: "wrongRange" | "wrongReference" | "wrongOperator" | "wrongTaxBase" | "wrongTotalOperator";
    }
  | {
      category: "reconciliation";
      row: number;
      variant: "listPriceRecorded" | "originalQuantityRecorded" | "orderedNotDelivered" | "rejectedExpenseIncluded";
    };

// ---------------------------------------------------------------------------
// Formatting helpers (also used by the UI for consistent number display)
// ---------------------------------------------------------------------------

const moneyFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (value: number) => moneyFormat.format(value);
const money = (cents: number) => formatMoney(cents / 100);
const rawMoney = (cents: number) => (cents / 100).toFixed(2);
const percent = (rate: number) => `${+(rate * 100).toFixed(2)}%`;
const label = (row: number, col: number) => addressLabel({ row, col });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Creates a short human-friendly seed, e.g. "RR-7K2Q9X". Call from event handlers only. */
export function createSeed(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(random() * alphabet.length)];
  return `RR-${suffix}`;
}

export function generateChallenge(seed: string): Challenge {
  // Rare seeds can produce an unusable combination (e.g. a discount making two
  // neighboring prices equal). Retry with deterministic derived seeds.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const challenge = buildChallenge(seed, attempt === 0 ? seed : `${seed}#${attempt}`);
      if (findIntegrityProblems(challenge).length === 0) return challenge;
    } catch {
      // Unplantable slot; try the next derived seed.
    }
  }
  throw new Error(`Could not generate a valid challenge for seed ${seed}`);
}

/** Sheet source over the solution contents. */
export function solutionSource(challenge: Challenge): SheetSource {
  return {
    rowCount: challenge.rowCount,
    colCount: challenge.colCount,
    getContent: (address) => challenge.cells.get(cellKey(address))?.solution,
  };
}

/**
 * Verifies the guarantees the game relies on. Returns a list of problems
 * (empty when the challenge is sound). Used by the generator and tests.
 */
export function findIntegrityProblems(challenge: Challenge): string[] {
  const problems: string[] = [];
  const solution = solutionSource(challenge);

  if (challenge.errors.length !== ERRORS_PER_ROUND) problems.push(`expected ${ERRORS_PER_ROUND} errors`);
  if (challenge.ledgerRowCount < 12 || challenge.ledgerRowCount > 20) problems.push("ledger must have 12–20 rows");

  const categories = new Set(challenge.errors.map((e) => e.category));
  if (categories.size !== 4) problems.push("all four error categories must be present");

  const errorKeys = new Set(challenge.errors.map((e) => cellKey(e.address)));
  if (errorKeys.size !== ERRORS_PER_ROUND) problems.push("errors must target distinct cells");
  if (new Set(challenge.errors.map((e) => e.address.row)).size !== ERRORS_PER_ROUND) {
    problems.push("errors must be on distinct rows");
  }

  for (const cell of challenge.cells.values()) {
    const key = cellKey(cell.address);
    const differs = normalizeContent(cell.initial) !== normalizeContent(cell.solution);
    if (differs !== errorKeys.has(key)) problems.push(`unexpected difference at ${addressLabel(cell.address)}`);
    if (cell.editable) {
      const value = evaluateCell(solution, cell.address);
      if (value.kind !== "number") problems.push(`solution at ${addressLabel(cell.address)} is not numeric`);
    }
  }

  for (const error of challenge.errors) {
    const cell = challenge.cells.get(cellKey(error.address));
    if (!cell?.editable) {
      problems.push(`error at ${addressLabel(error.address)} is not editable`);
      continue;
    }
    // The planted content must evaluate to a different value in a correct sheet.
    const corrupted = evaluateCell(withOverride(solution, error.address, cell.initial), error.address);
    const expected = evaluateCell(solution, error.address);
    if (valuesMatch(corrupted, expected)) problems.push(`error at ${addressLabel(error.address)} has no effect`);
    if (!challenge.documents.some((d) => d.id === error.documentId)) problems.push("missing evidence document");
  }

  return problems;
}

/** Numeric equality with a half-cent tolerance. */
export function valuesMatch(actual: CellValue, expected: CellValue): boolean {
  return actual.kind === "number" && expected.kind === "number" && Math.abs(actual.value - expected.value) < 0.005;
}

export function withOverride(source: SheetSource, address: CellAddress, content: string): SheetSource {
  const key = cellKey(address);
  return { ...source, getContent: (a) => (cellKey(a) === key ? content : source.getContent(a)) };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function buildChallenge(seed: string, rngSeed: string): Challenge {
  const rng = createRng(rngSeed);
  const template = rng.pick(TEMPLATES);
  const itemCount = rng.int(MIN_LINE_ITEMS, MAX_LINE_ITEMS);
  const layout: Layout = {
    firstItemRow: 1,
    lastItemRow: itemCount,
    subtotalRow: itemCount + 2,
    taxRow: itemCount + 3,
    totalRow: itemCount + 4,
    ledgerRowCount: itemCount + 5,
  };

  const items = createItems(rng, template, itemCount);
  const slots = chooseSlots(rng, items, layout);
  assignShapes(rng, items, slots);

  const cells = buildSolutionCells(template, items, layout);
  const documents = buildDocuments(rng, template, items);
  const memo = documents.find((d) => d.kind === "memo")!;
  const errors = slots.map((slot, i) => plantError(rng, slot, i, { items, layout, cells, documents, memo, template }));

  return {
    seed,
    templateId: template.id,
    department: template.department,
    title: template.title,
    fileName: template.fileName,
    rowCount: layout.ledgerRowCount + PADDING_ROWS,
    colCount: GRID_COLUMNS,
    ledgerRowCount: layout.ledgerRowCount,
    cells,
    documents,
    errors,
  };
}

function randomPriceCents(rng: Rng, [min, max]: readonly [number, number]): number {
  const dollars = rng.int(min, max);
  const cents = dollars >= 500 ? rng.pick([0, 0, 0, 50]) : rng.pick([0, 0, 25, 49, 50, 75, 95, 99, rng.int(1, 98)]);
  return dollars * 100 + cents;
}

function createItems(rng: Rng, template: LedgerTemplate, count: number): LineItem[] {
  const usedNumbers = new Set<string>();
  const months = ["Oct", "Nov", "Dec"];

  return rng
    .shuffle(template.items)
    .slice(0, count)
    .map((spec, i) => {
      const docKind = rng.pick(spec.docs);
      let docNumber: string;
      do {
        docNumber =
          docKind === "invoice"
            ? `INV-${rng.int(10000, 99999)}`
            : docKind === "purchaseOrder"
              ? `PO-${rng.int(2000, 8999)}`
              : `EXP-${rng.int(1000, 9999)}`;
      } while (usedNumbers.has(docNumber));
      usedNumbers.add(docNumber);

      return {
        row: 1 + i,
        spec,
        docKind,
        docNumber,
        date: `${rng.pick(months)} ${String(rng.int(1, 28)).padStart(2, "0")}`,
        qty: rng.int(spec.qty[0], spec.qty[1]),
        priceCents: randomPriceCents(rng, spec.price),
        shape: { kind: "standard" },
      };
    });
}

function reconciliationVariantFor(item: LineItem): Extract<Slot, { category: "reconciliation" }>["variant"] | null {
  if (item.docKind === "expenseReport") return "rejectedExpenseIncluded";
  if (item.docKind === "purchaseOrder") return "originalQuantityRecorded";
  return null; // invoices choose between two variants below
}

function chooseSlots(rng: Rng, items: LineItem[], layout: Layout): Slot[] {
  const allCategories: ErrorCategory[] = ["dataEntry", "calculation", "formula", "reconciliation"];
  const shuffled = rng.shuffle([...allCategories, rng.pick(allCategories)]);
  // Reconciliation depends on the document kind of its row, so place it first.
  const categories = [
    ...shuffled.filter((c) => c === "reconciliation"),
    ...shuffled.filter((c) => c !== "reconciliation"),
  ];

  const usedRows = new Set<number>();
  const freeItems = () => items.filter((item) => !usedRows.has(item.row));
  const take = <T extends Slot>(slot: T): T => {
    usedRows.add(slot.row);
    return slot;
  };

  return categories.map((category): Slot => {
    switch (category) {
      case "reconciliation": {
        const item = rng.pick(freeItems());
        const variant =
          reconciliationVariantFor(item) ?? rng.pick(["listPriceRecorded", "orderedNotDelivered"] as const);
        return take({ category, row: item.row, variant });
      }
      case "dataEntry": {
        const item = rng.pick(freeItems());
        const field = item.docKind === "expenseReport" ? "price" : rng.chance(0.55) ? "price" : "qty";
        return take({ category, row: item.row, field });
      }
      case "calculation": {
        if (!usedRows.has(layout.subtotalRow) && rng.chance(0.25)) {
          return take({ category, row: layout.subtotalRow, variant: "staleSubtotal" });
        }
        const item = rng.pick(freeItems());
        return take({ category, row: item.row, variant: rng.pick(["offByOneUnit", "transposedResult"] as const) });
      }
      case "formula": {
        const options: Extract<Slot, { category: "formula" }>[] = [];
        if (!usedRows.has(layout.subtotalRow)) options.push({ category, row: layout.subtotalRow, variant: "wrongRange" });
        if (!usedRows.has(layout.taxRow)) options.push({ category, row: layout.taxRow, variant: "wrongTaxBase" });
        if (!usedRows.has(layout.totalRow)) options.push({ category, row: layout.totalRow, variant: "wrongTotalOperator" });
        const free = freeItems();
        const referenceable = free.filter((item) => neighborWithDifferentPrice(items, item) !== null);
        if (referenceable.length > 0) {
          options.push({ category, row: rng.pick(referenceable).row, variant: "wrongReference" });
        }
        if (free.length > 0) options.push({ category, row: rng.pick(free).row, variant: "wrongOperator" });
        return take(rng.pick(options));
      }
    }
  });
}

function neighborWithDifferentPrice(items: LineItem[], item: LineItem): LineItem | null {
  const index = items.indexOf(item);
  const candidates = [items[index + 1], items[index - 1]].filter(Boolean);
  return candidates.find((other) => other.priceCents !== item.priceCents) ?? null;
}

function makeExpenseShape(rng: Rng, item: LineItem, withRejection: boolean): Shape {
  const labels = rng.shuffle(item.spec.claimParts ?? ["Expenses"]).slice(0, rng.int(2, 3));
  // Split the approved total into whole-cent parts that sum exactly.
  const weights = labels.map(() => rng.int(2, 10));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let remaining = item.priceCents;
  const parts = labels.map((labelText, i) => {
    const cents = i === labels.length - 1 ? remaining : Math.max(100, Math.round((item.priceCents * weights[i]) / totalWeight));
    remaining -= cents;
    return { label: labelText, cents };
  });
  if (parts.some((part) => part.cents <= 0)) {
    // Degenerate split: fall back to a single line.
    return { kind: "expense", parts: [{ label: labels[0], cents: item.priceCents }], rejected: withRejection ? rejectedLine(rng) : null };
  }
  return { kind: "expense", parts, rejected: withRejection ? rejectedLine(rng) : null };
}

function rejectedLine(rng: Rng) {
  const choice = rng.pick(REJECTED_EXPENSES);
  return { ...choice, cents: rng.int(18, 95) * 100 + rng.pick([0, 50, 99]) };
}

function makeDiscountShape(rng: Rng, item: LineItem): Shape {
  const discountPct = rng.pick([5, 10, 12, 15, 20]);
  const listCents = item.priceCents;
  // The recorded (net) price is derived from the list price, rounded to cents.
  item.priceCents = Math.round((listCents * (100 - discountPct)) / 100);
  return { kind: "discount", listCents, discountPct };
}

function makeAmendedShape(rng: Rng, item: LineItem): Shape {
  const delta = rng.int(1, Math.max(2, Math.round(item.qty * 0.5)));
  const originalQty = item.qty - delta >= 1 && rng.chance(0.4) ? item.qty - delta : item.qty + delta;
  return { kind: "amended", originalQty };
}

function makePartialShape(rng: Rng, item: LineItem): Shape {
  return { kind: "partial", orderedQty: item.qty + rng.int(1, Math.max(2, Math.round(item.qty * 0.3))) };
}

function assignShapes(rng: Rng, items: LineItem[], slots: Slot[]) {
  for (const item of items) {
    const slot = slots.find((s) => s.row === item.row);
    const recon = slot?.category === "reconciliation" ? slot.variant : null;

    if (item.docKind === "expenseReport") {
      item.shape = makeExpenseShape(rng, item, recon === "rejectedExpenseIncluded" || rng.chance(0.5));
    } else if (recon === "listPriceRecorded") {
      item.shape = makeDiscountShape(rng, item);
    } else if (recon === "orderedNotDelivered") {
      item.shape = makePartialShape(rng, item);
    } else if (recon === "originalQuantityRecorded") {
      item.shape = makeAmendedShape(rng, item);
    } else if (item.docKind === "invoice") {
      // Distractors: correct rows backed by complex documents.
      const roll = rng.next();
      if (roll < 0.25) item.shape = makeDiscountShape(rng, item);
      else if (roll < 0.4) item.shape = makePartialShape(rng, item);
    } else if (item.docKind === "purchaseOrder" && rng.chance(0.3)) {
      item.shape = makeAmendedShape(rng, item);
    }
  }
}

function buildSolutionCells(template: LedgerTemplate, items: LineItem[], layout: Layout): Map<string, ChallengeCell> {
  const cells = new Map<string, ChallengeCell>();
  const add = (row: number, col: number, content: string, role: ChallengeCell["role"], format: ChallengeCell["format"]) => {
    const address = { row, col };
    const editable = role === "input" || role === "computed";
    cells.set(cellKey(address), { address, role, format, editable, initial: content, solution: content });
  };

  ["Ref", "Vendor", "Description", "Qty", "Unit price", "Amount"].forEach((text, col) => add(0, col, text, "header", "text"));

  for (const item of items) {
    const r = item.row;
    add(r, COL.ref, item.docNumber, "text", "text");
    add(r, COL.vendor, item.spec.vendor, "text", "text");
    add(r, COL.description, item.spec.description, "text", "text");
    add(r, COL.qty, String(item.qty), "input", "integer");
    add(r, COL.price, rawMoney(item.priceCents), "input", "currency");
    add(r, COL.amount, `=${label(r, COL.qty)}*${label(r, COL.price)}`, "computed", "currency");
  }

  const amountRange = `${label(layout.firstItemRow, COL.amount)}:${label(layout.lastItemRow, COL.amount)}`;
  add(layout.subtotalRow, COL.price, "Subtotal", "label", "text");
  add(layout.subtotalRow, COL.amount, `=SUM(${amountRange})`, "computed", "currency");
  add(layout.taxRow, COL.price, `${template.taxLabel} (${percent(template.taxRate)})`, "label", "text");
  add(layout.taxRow, COL.amount, `=${label(layout.subtotalRow, COL.amount)}*${template.taxRate}`, "computed", "currency");
  add(layout.totalRow, COL.price, "Total", "label", "text");
  add(
    layout.totalRow,
    COL.amount,
    `=${label(layout.subtotalRow, COL.amount)}+${label(layout.taxRow, COL.amount)}`,
    "computed",
    "currency",
  );

  return cells;
}

function buildDocuments(rng: Rng, template: LedgerTemplate, items: LineItem[]): SourceDocument[] {
  const documents = items.map((item): SourceDocument => {
    const lineTotal = item.qty * item.priceCents;
    const base = {
      id: item.docNumber,
      number: item.docNumber,
      issuer: item.spec.vendor,
      date: item.date,
      row: item.row,
      subject: item.spec.description,
    };
    const shape = item.shape;

    switch (shape.kind) {
      case "expense": {
        const claimed = shape.parts.reduce((sum, p) => sum + p.cents, 0) + (shape.rejected?.cents ?? 0);
        const lines: DocumentLine[] = shape.parts.map((p) => ({ label: p.label, value: money(p.cents) }));
        if (shape.rejected) {
          lines.push({ label: `${shape.rejected.label} (rejected: ${shape.rejected.reason})`, value: money(shape.rejected.cents), tone: "struck" });
          lines.push({ label: "Claimed total", value: money(claimed), tone: "muted" });
        }
        lines.push({ label: "Approved total", value: money(item.priceCents), tone: "final" });
        return { ...base, kind: "expenseReport", title: "Expense Report", lines, stamp: "APPROVED", footnote: "Record one unit at the approved total." };
      }
      case "discount":
        return {
          ...base,
          kind: item.docKind,
          title: "Invoice",
          lines: [
            { label: "Quantity", value: String(item.qty) },
            { label: "List price", value: money(shape.listCents), tone: "muted" },
            { label: "Contract discount", value: `−${shape.discountPct}%`, tone: "muted" },
            { label: "Net unit price", value: money(item.priceCents), tone: "final" },
            { label: "Line total", value: money(lineTotal) },
          ],
          footnote: "Contract pricing applies. Pay net amount.",
        };
      case "partial":
        return {
          ...base,
          kind: "invoice",
          title: "Invoice",
          lines: [
            { label: "Quantity ordered", value: String(shape.orderedQty), tone: "muted" },
            { label: "Delivered & billed", value: String(item.qty), tone: "final" },
            { label: "Unit price", value: money(item.priceCents) },
            { label: "Amount billed", value: money(lineTotal) },
          ],
          stamp: "PARTIAL DELIVERY",
          footnote: "Remaining units back-ordered and billed separately.",
        };
      case "amended":
        return {
          ...base,
          kind: "purchaseOrder",
          title: "Purchase Order",
          lines: [
            { label: "Quantity (Rev. 1)", value: String(shape.originalQty), tone: "struck" },
            { label: "Revised quantity (Rev. 2)", value: String(item.qty), tone: "final" },
            { label: "Unit price", value: money(item.priceCents) },
            { label: "Approved total", value: money(lineTotal) },
          ],
          stamp: "REVISED",
        };
      case "standard":
        return {
          ...base,
          kind: item.docKind,
          title: item.docKind === "purchaseOrder" ? "Purchase Order" : "Invoice",
          lines: [
            { label: "Quantity", value: String(item.qty) },
            { label: "Unit price", value: money(item.priceCents) },
            { label: item.docKind === "purchaseOrder" ? "PO total" : "Line total", value: money(lineTotal) },
          ],
          stamp: item.docKind === "purchaseOrder" ? "APPROVED" : undefined,
        };
    }
  });

  documents.push({
    id: "memo",
    kind: "memo",
    number: `FIN-OPS-${rng.int(100, 999)}`,
    title: "Reconciliation Memo",
    issuer: "Finance Operations",
    date: "Fri 4:57 PM",
    row: null,
    subject: `${template.department} · ${template.title}`,
    lines: [
      { label: "Line amount", value: "Qty × unit price" },
      { label: "Subtotal", value: "Sum of all line amounts" },
      { label: template.taxLabel, value: `${percent(template.taxRate)} of subtotal` },
      { label: "Total", value: `Subtotal + ${template.taxLabel.toLowerCase()}` },
      { label: "Record", value: "Final figures: net prices, revised & delivered quantities, approved expense totals" },
    ],
    footnote: "Your manager has already left for the weekend.",
  });

  return documents;
}

// ---------------------------------------------------------------------------
// Error planting
// ---------------------------------------------------------------------------

interface PlantContext {
  items: LineItem[];
  layout: Layout;
  cells: Map<string, ChallengeCell>;
  documents: SourceDocument[];
  memo: SourceDocument;
  template: LedgerTemplate;
}

function corrupt(cells: Map<string, ChallengeCell>, address: CellAddress, content: string) {
  const key = cellKey(address);
  const cell = cells.get(key)!;
  cells.set(key, { ...cell, initial: content });
}

function swapAdjacentDigits(rng: Rng, digits: string): string | null {
  const pairs: number[] = [];
  for (let i = 0; i < digits.length - 1; i++) {
    if (digits[i] !== digits[i + 1] && !(i === 0 && digits[i + 1] === "0")) pairs.push(i);
  }
  if (pairs.length === 0) return null;
  const i = rng.pick(pairs);
  return digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2);
}

function removeAZero(rng: Rng, digits: string): string | null {
  const positions = [...digits].map((d, i) => (d === "0" && i > 0 ? i : -1)).filter((i) => i >= 0);
  if (positions.length === 0) return null;
  const i = rng.pick(positions);
  return digits.slice(0, i) + digits.slice(i + 1);
}

function finalFigureLabel(item: LineItem, field: "qty" | "price"): string {
  const shape = item.shape.kind;
  if (field === "qty") return shape === "amended" ? "revised quantity" : shape === "partial" ? "delivered & billed quantity" : "quantity";
  return shape === "discount" ? "net unit price" : shape === "expense" ? "approved total" : "unit price";
}

function plantError(rng: Rng, slot: Slot, index: number, ctx: PlantContext): PlantedError {
  const { items, layout, cells, memo } = ctx;
  const item = items.find((i) => i.row === slot.row);
  const doc = item ? ctx.documents.find((d) => d.id === item.docNumber)! : memo;
  const lineTotalCents = item ? item.qty * item.priceCents : 0;
  const make = (address: CellAddress, variant: ErrorVariant, evidence: string, explanation: string): PlantedError => ({
    id: `error-${index + 1}`,
    address,
    category: slot.category,
    variant,
    difficulty: DIFFICULTY[variant],
    documentId: doc.id,
    evidence,
    explanation,
  });

  switch (slot.category) {
    case "dataEntry": {
      const it = item!;
      const field = slot.field;
      const address = { row: it.row, col: field === "qty" ? COL.qty : COL.price };
      const isPrice = field === "price";
      const correct = isPrice ? it.priceCents : it.qty;
      const show = (v: number) => (isPrice ? rawMoney(v) : String(v));
      const display = (v: number) => (isPrice ? money(v) : String(v));

      const options: { variant: ErrorVariant; value: number }[] = [];
      const swapped = swapAdjacentDigits(rng, String(correct));
      if (swapped) options.push({ variant: "transposedDigits", value: Number(swapped) });
      if (isPrice) {
        const dollars = Math.floor(correct / 100);
        options.push({ variant: "extraZero", value: dollars * 1000 + (correct % 100) });
        const fewer = removeAZero(rng, String(dollars));
        if (fewer) options.push({ variant: "missingZero", value: Number(fewer) * 100 + (correct % 100) });
        options.push({ variant: "decimalShift", value: correct % 10 === 0 ? correct / 10 : correct * 10 });
      } else {
        options.push({ variant: "extraZero", value: correct * 10 });
        const fewer = removeAZero(rng, String(correct));
        if (fewer && Number(fewer) > 0) options.push({ variant: "missingZero", value: Number(fewer) });
      }
      options.push({ variant: "wrongSign", value: -correct });

      const choice = rng.pick(options.filter((o) => o.value !== correct));
      corrupt(cells, address, show(choice.value));
      const figure = finalFigureLabel(it, field);
      const shown = display(choice.value);
      const right = display(correct);
      const explanations: Partial<Record<ErrorVariant, string>> = {
        transposedDigits: `Two digits were swapped: the sheet showed ${shown}, but ${doc.number} lists a ${figure} of ${right}.`,
        extraZero: `An extra zero crept in: ${shown} instead of ${right} (${figure} on ${doc.number}).`,
        missingZero: `A zero went missing: ${shown} instead of ${right} (${figure} on ${doc.number}).`,
        decimalShift: `The decimal point moved: ${shown} instead of ${right} (${figure} on ${doc.number}).`,
        wrongSign: `The value was entered as negative (${shown}). ${doc.number} shows a ${figure} of ${right}.`,
      };
      return make(address, choice.variant, `${doc.number} · ${capitalize(figure)} ${right}`, explanations[choice.variant]!);
    }

    case "calculation": {
      if (slot.variant === "staleSubtotal") {
        const skipped = rng.pick(items);
        const subtotal = items.reduce((sum, i) => sum + i.qty * i.priceCents, 0);
        const address = { row: layout.subtotalRow, col: COL.amount };
        corrupt(cells, address, rawMoney(subtotal - skipped.qty * skipped.priceCents));
        return make(
          address,
          slot.variant,
          `${memo.number} · Subtotal = sum of all line amounts`,
          `The subtotal was a hard-coded number that left out row ${skipped.row + 1} (${skipped.spec.vendor}). ` +
            `It should be =SUM(${label(layout.firstItemRow, COL.amount)}:${label(layout.lastItemRow, COL.amount)}).`,
        );
      }
      const it = item!;
      const address = { row: it.row, col: COL.amount };
      let wrong: number | null = null;
      let variant: ErrorVariant = slot.variant;
      if (variant === "transposedResult") {
        const swapped = swapAdjacentDigits(rng, String(lineTotalCents));
        wrong = swapped ? Number(swapped) : null;
      }
      if (wrong === null || wrong === lineTotalCents) {
        variant = "offByOneUnit";
        const qty = it.qty > 1 && rng.chance(0.5) ? it.qty - 1 : it.qty + 1;
        wrong = qty * it.priceCents;
      }
      corrupt(cells, address, rawMoney(wrong));
      return make(
        address,
        variant,
        `${doc.number} · ${it.qty} × ${money(it.priceCents)} = ${money(lineTotalCents)}`,
        `The amount was typed in as ${money(wrong)} instead of being calculated: ` +
          `${it.qty} × ${money(it.priceCents)} = ${money(lineTotalCents)}.`,
      );
    }

    case "formula": {
      const subtotal = label(layout.subtotalRow, COL.amount);
      const tax = label(layout.taxRow, COL.amount);
      const fullRange = `${label(layout.firstItemRow, COL.amount)}:${label(layout.lastItemRow, COL.amount)}`;
      switch (slot.variant) {
        case "wrongRange": {
          const skipFirst = rng.chance(0.5);
          const range = skipFirst
            ? `${label(layout.firstItemRow + 1, COL.amount)}:${label(layout.lastItemRow, COL.amount)}`
            : `${label(layout.firstItemRow, COL.amount)}:${label(layout.lastItemRow - 1, COL.amount)}`;
          const skippedRow = (skipFirst ? layout.firstItemRow : layout.lastItemRow) + 1;
          const address = { row: layout.subtotalRow, col: COL.amount };
          corrupt(cells, address, `=SUM(${range})`);
          return make(
            address,
            slot.variant,
            `${memo.number} · Subtotal = sum of all line amounts`,
            `The SUM range (${range}) skipped row ${skippedRow}. Correct: =SUM(${fullRange}).`,
          );
        }
        case "wrongTaxBase": {
          const address = { row: layout.taxRow, col: COL.amount };
          const wrongBase = label(layout.lastItemRow, COL.amount);
          corrupt(cells, address, `=${wrongBase}*${ctx.template.taxRate}`);
          return make(
            address,
            slot.variant,
            `${memo.number} · ${ctx.template.taxLabel} = ${percent(ctx.template.taxRate)} of subtotal`,
            `Tax was calculated on the last line item (${wrongBase}) instead of the subtotal. Correct: =${subtotal}*${ctx.template.taxRate}.`,
          );
        }
        case "wrongTotalOperator": {
          const address = { row: layout.totalRow, col: COL.amount };
          corrupt(cells, address, `=${subtotal}-${tax}`);
          return make(
            address,
            slot.variant,
            `${memo.number} · Total = subtotal + ${ctx.template.taxLabel.toLowerCase()}`,
            `The total subtracted ${ctx.template.taxLabel.toLowerCase()} instead of adding it. Correct: =${subtotal}+${tax}.`,
          );
        }
        case "wrongReference": {
          const it = item!;
          const neighbor = neighborWithDifferentPrice(items, it);
          if (!neighbor) break;
          const address = { row: it.row, col: COL.amount };
          const formula = `=${label(it.row, COL.qty)}*${label(neighbor.row, COL.price)}`;
          corrupt(cells, address, formula);
          return make(
            address,
            slot.variant,
            `${doc.number} · Line total ${money(lineTotalCents)}`,
            `The formula ${formula} used the unit price from row ${neighbor.row + 1} instead of row ${it.row + 1}. ` +
              `Correct: =${label(it.row, COL.qty)}*${label(it.row, COL.price)}.`,
          );
        }
        case "wrongOperator": {
          const it = item!;
          const address = { row: it.row, col: COL.amount };
          corrupt(cells, address, `=${label(it.row, COL.qty)}+${label(it.row, COL.price)}`);
          return make(
            address,
            slot.variant,
            `${doc.number} · Line total ${money(lineTotalCents)}`,
            `The formula added quantity and unit price instead of multiplying them. Correct: =${label(it.row, COL.qty)}*${label(it.row, COL.price)}.`,
          );
        }
      }
      break;
    }

    case "reconciliation": {
      const it = item!;
      const shape = it.shape;
      if (slot.variant === "listPriceRecorded" && shape.kind === "discount") {
        const address = { row: it.row, col: COL.price };
        corrupt(cells, address, rawMoney(shape.listCents));
        return make(
          address,
          slot.variant,
          `${doc.number} · Net unit price ${money(it.priceCents)}`,
          `The list price (${money(shape.listCents)}) was recorded. ${doc.number} applies a ${shape.discountPct}% contract discount: net unit price ${money(it.priceCents)}.`,
        );
      }
      if (slot.variant === "orderedNotDelivered" && shape.kind === "partial") {
        const address = { row: it.row, col: COL.qty };
        corrupt(cells, address, String(shape.orderedQty));
        return make(
          address,
          slot.variant,
          `${doc.number} · Delivered & billed ${it.qty}`,
          `The ordered quantity (${shape.orderedQty}) was recorded, but only ${it.qty} units were delivered and billed on ${doc.number}.`,
        );
      }
      if (slot.variant === "originalQuantityRecorded" && shape.kind === "amended") {
        const address = { row: it.row, col: COL.qty };
        corrupt(cells, address, String(shape.originalQty));
        return make(
          address,
          slot.variant,
          `${doc.number} · Revised quantity (Rev. 2) ${it.qty}`,
          `The original order quantity (${shape.originalQty}) was recorded, but ${doc.number} was revised to ${it.qty}.`,
        );
      }
      if (slot.variant === "rejectedExpenseIncluded" && shape.kind === "expense" && shape.rejected) {
        const claimed = it.priceCents + shape.rejected.cents;
        const address = { row: it.row, col: COL.price };
        corrupt(cells, address, rawMoney(claimed));
        return make(
          address,
          slot.variant,
          `${doc.number} · Approved total ${money(it.priceCents)}`,
          `The claimed total (${money(claimed)}) still included a rejected item: ${shape.rejected.label} (${money(shape.rejected.cents)}). Approved total: ${money(it.priceCents)}.`,
        );
      }
      break;
    }
  }
  throw new Error(`Unplantable slot: ${JSON.stringify(slot)}`);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
