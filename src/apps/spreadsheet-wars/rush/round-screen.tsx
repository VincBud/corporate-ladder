"use client";

import { useEffect, useId, useMemo, useRef, useState, type Dispatch } from "react";
import { CloseIcon, InfoIcon } from "@/components/icons";
import { SheetEvaluator, normalizeContent } from "@/games/spreadsheet-wars/formula";
import { COL, ERRORS_PER_ROUND } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import { HINTS_PER_ROUND } from "@/games/spreadsheet-wars/reconciliation-rush/hints";
import {
  hintsRemaining,
  remainingMs,
  type ActiveRound,
  type SpreadsheetWarsAction,
} from "@/games/spreadsheet-wars/reconciliation-rush/machine";
import { contentAt, isEdited } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import { addressLabel, cellKey, moveAddress, type CellAddress, type Direction } from "@/games/spreadsheet-wars/sheet";
import { cn } from "@/lib/cn";
import { SheetGrid, handleEditorBlur, handleEditorKeyDown, type CellEditing, type GridCellView } from "../sheet-grid";
import { DocumentsPanel } from "./documents-panel";
import { formatCellValue, formatCountdown } from "./format";
import { useRoundClock } from "./use-round-clock";

const COLUMN_WIDTHS = ["min-w-22", "min-w-34", "min-w-48", "min-w-14", "min-w-26", "min-w-28", "min-w-14", "min-w-14"];

interface RoundScreenProps {
  round: ActiveRound;
  dispatch: Dispatch<SpreadsheetWarsAction>;
  /** Verified rounds: asks the server for the hint. Rejects with a readable message. */
  onRequestVerifiedHint?: () => Promise<void>;
}

type Dialog = "submit" | "abandon" | null;

export function RoundScreen({ round, dispatch, onRequestVerifiedHint }: RoundScreenProps) {
  const { challenge } = round;
  const id = useId();
  const gridRef = useRef<HTMLTableElement>(null);
  const [selected, setSelected] = useState<CellAddress>({ row: 1, col: COL.qty });
  const [editing, setEditing] = useState<CellEditing | null>(null);
  const [lastCommit, setLastCommit] = useState<{ key: string; count: number }>({ key: "", count: 0 });
  const [status, setStatus] = useState("Round started. Find the five errors.");
  const [dialog, setDialog] = useState<Dialog>(null);
  // Wide windows show documents beside the sheet; narrow ones as an overlay.
  const [docsBeside, setDocsBeside] = useState(true);
  const [docsOverlay, setDocsOverlay] = useState(false);
  const [hintHidden, setHintHidden] = useState(false);
  const [revealSignal, setRevealSignal] = useState(0);
  const [hintPending, setHintPending] = useState(false);

  const now = useRoundClock(round.startedAt, round.durationMs, (time) => dispatch({ type: "tick", now: time }));
  const remaining = remainingMs(round, now);
  const expired = remaining === 0;

  useEffect(() => {
    gridRef.current?.focus({ preventScroll: true });
  }, []);

  const evaluator = useMemo(
    () =>
      new SheetEvaluator({
        rowCount: challenge.rowCount,
        colCount: challenge.colCount,
        getContent: (address) => contentAt(challenge, round.entries, address),
      }),
    [challenge, round.entries],
  );

  const editedCount = useMemo(
    () => [...challenge.cells.values()].filter((cell) => cell.editable && isEdited(challenge, round.entries, cell.address)).length,
    [challenge, round.entries],
  );

  const bounds = { name: challenge.title, rowCount: challenge.rowCount, colCount: challenge.colCount, cells: new Map() };
  const canEdit = (address: CellAddress) => !expired && Boolean(challenge.cells.get(cellKey(address))?.editable);
  const isSummaryRow = (row: number) => challenge.cells.get(cellKey({ row, col: COL.price }))?.role === "label";

  function getCell(address: CellAddress): GridCellView {
    const key = cellKey(address);
    const cell = challenge.cells.get(key);
    if (!cell) return { text: "" };
    const edited = cell.editable && isEdited(challenge, round.entries, address);

    if (editing?.origin === "bar" && cellKey(editing.address) === key) {
      return { text: editing.draft, edited };
    }
    const { text, align, isError } = formatCellValue(evaluator.value(address), cell.format);
    const tone: GridCellView["tone"] = isError
      ? "error"
      : cell.role === "header"
        ? "header"
        : cell.role === "label"
          ? "label"
          : isSummaryRow(address.row)
            ? "total"
            : address.col === COL.ref
              ? "muted"
              : undefined;
    return { text, align, tone, edited, flashKey: lastCommit.key === key ? lastCommit.count : undefined };
  }

  function blocked(address: CellAddress) {
    setStatus(
      expired
        ? "Time is up. Editing is closed."
        : `${addressLabel(address)} is locked. Only Qty, Unit price and Amount cells can be edited.`,
    );
  }

  function startEdit(address: CellAddress, draft: string | null, origin: CellEditing["origin"] = "cell") {
    if (!canEdit(address)) {
      blocked(address);
      return;
    }
    setSelected(address);
    setEditing({ address, draft: draft ?? contentAt(challenge, round.entries, address), origin });
  }

  function commit(move: Direction | null) {
    if (!editing) return;
    const { address, draft } = editing;
    const key = cellKey(address);
    const changed = normalizeContent(draft) !== normalizeContent(contentAt(challenge, round.entries, address));
    setEditing(null);
    // The reducer re-checks the deadline, so a late commit finalizes the round instead.
    dispatch({ type: "commitCell", address, content: draft, now: performance.now() });
    if (changed) {
      setLastCommit((previous) => ({ key, count: previous.count + 1 }));
      setStatus(`${addressLabel(address)} updated.`);
    }
    if (move) {
      setSelected(moveAddress(bounds, address, move));
      gridRef.current?.focus({ preventScroll: true });
    }
  }

  function requestAssistance() {
    setHintHidden(false);
    if (round.mode === "verified" && onRequestVerifiedHint) {
      // The server picks an unresolved discrepancy; the browser has no answer key.
      setHintPending(true);
      setStatus("Asking Finance Operations…");
      onRequestVerifiedHint().then(
        () => setStatus("Assistance requested. Finance Operations replied above the sheet."),
        (error: Error) => setStatus(error.message),
      ).finally(() => setHintPending(false));
      return;
    }
    // The reducer picks an unresolved discrepancy from the current sheet and
    // enforces one use per round and the deadline. The clock is unaffected.
    dispatch({ type: "requestHint", now: performance.now() });
    setStatus("Assistance requested. Finance Operations replied above the sheet.");
  }

  function goToHintRow(row: number) {
    setSelected({ row, col: COL.ref });
    setRevealSignal((n) => n + 1);
    setDocsBeside(true);
    gridRef.current?.focus({ preventScroll: true });
  }

  function cancel() {
    setEditing(null);
    setStatus("Edit cancelled.");
    gridRef.current?.focus({ preventScroll: true });
  }

  const hint = round.hint;
  const hintsLeft = hintsRemaining(round);
  const fraction = remaining / round.durationMs;
  const urgency = remaining <= 10_000 ? "critical" : remaining <= 30_000 ? "warning" : "normal";
  const announcement =
    remaining <= 10_000 ? "10 seconds remaining." : remaining <= 30_000 ? "30 seconds remaining." : remaining <= 60_000 ? "1 minute remaining." : "";

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white text-slate-800">
      {/* Round header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900">
            Reconciliation Rush
            {round.mode === "verified" && (
              <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-emerald-800">
                Verified
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {challenge.fileName} · {challenge.department}
          </p>
        </div>

        <p className="text-[12px] text-slate-600 tabular-nums">
          <span className="font-semibold text-slate-900">{editedCount}</span> {editedCount === 1 ? "cell" : "cells"} edited ·{" "}
          {ERRORS_PER_ROUND} errors to find
        </p>

        <div
          role="timer"
          aria-label={`Time remaining ${formatCountdown(remaining)}`}
          className={cn(
            "rounded-md px-2.5 py-1 font-mono text-lg leading-none font-semibold tabular-nums ring-1 ring-inset",
            urgency === "critical"
              ? "bg-rose-50 text-rose-700 ring-rose-200"
              : urgency === "warning"
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-white text-slate-900 ring-slate-200",
          )}
        >
          {formatCountdown(remaining)}
        </div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={requestAssistance}
            disabled={expired || hintsLeft === 0 || hintPending}
            title={hintsLeft > 0 ? "Finance Operations will point you to one unresolved row. The clock keeps running." : "Assistance already used this round"}
            className="h-8 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-[12px] font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
          >
            {hintPending ? "Requesting…" : `Request Assistance (${hintsLeft}/${HINTS_PER_ROUND})`}
          </button>
          <button
            type="button"
            onClick={() => setDocsBeside((open) => !open)}
            aria-pressed={docsBeside}
            className="hidden h-8 items-center rounded-md border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-100 aria-pressed:bg-slate-200/70 @3xl:flex"
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => setDocsOverlay(true)}
            className="flex h-8 items-center rounded-md border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-100 @3xl:hidden"
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => setDialog("abandon")}
            className="h-8 rounded-md px-2.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800"
          >
            Exit
          </button>
          <button
            type="button"
            onClick={() => setDialog("submit")}
            disabled={expired}
            className="h-8 rounded-md bg-emerald-600 px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      </div>

      {/* Time bar */}
      <div aria-hidden="true" className="h-1 bg-slate-100">
        <div
          className={cn(
            "h-full transition-[width] duration-200 ease-linear",
            urgency === "critical" ? "bg-rose-500" : urgency === "warning" ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>

      {hint && !hintHidden && (
        <div
          role="note"
          aria-labelledby={`${id}-hint-from`}
          className="flex animate-view-in items-start gap-3 border-b border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-950"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-sky-700 text-[9px] font-bold tracking-wide text-white"
          >
            FO
          </span>
          <div className="min-w-0 flex-1">
            <p id={`${id}-hint-from`} className="font-semibold">
              Finance Operations <span className="font-normal text-sky-700">· re: your request for assistance</span>
            </p>
            <p className="mt-0.5 leading-relaxed">{hint.message}</p>
          </div>
          {hint.row !== null && (
            <button
              type="button"
              onClick={() => goToHintRow(hint.row!)}
              className="shrink-0 rounded-md border border-sky-300 bg-white px-2 py-1 text-[11px] font-medium text-sky-800 transition-colors hover:bg-sky-100"
            >
              Go to row {hint.row + 1}
            </button>
          )}
          <button
            type="button"
            onClick={() => setHintHidden(true)}
            aria-label="Hide assistance message"
            className="grid size-6 shrink-0 place-items-center rounded-md text-sky-700 transition-colors hover:bg-sky-100"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      )}
      {/* Always mounted so the hint is announced when it arrives. */}
      <p className="sr-only" aria-live="polite">
        {hint ? `Finance Operations: ${hint.message}` : ""}
      </p>

      <FormulaBar
        selected={selected}
        content={contentAt(challenge, round.entries, selected)}
        editing={editing}
        canEdit={canEdit(selected)}
        onStartEdit={() => startEdit(selected, null, "bar")}
        onDraftChange={(draft) => setEditing((current) => (current ? { ...current, draft } : current))}
        onCommit={commit}
        onCancel={cancel}
      />

      <div className="relative flex min-h-0 flex-1">
        <SheetGrid
          label={`${challenge.title}. ${challenge.ledgerRowCount} rows. Arrow keys move, Enter edits.`}
          rowCount={challenge.rowCount}
          colCount={challenge.colCount}
          columnClassName={(col) => COLUMN_WIDTHS[col] ?? "min-w-16"}
          selected={selected}
          onSelect={setSelected}
          getCell={getCell}
          gridRef={gridRef}
          canEdit={canEdit}
          editing={editing}
          onStartEdit={(address, draft) => startEdit(address, draft)}
          onDraftChange={(draft) => setEditing((current) => (current ? { ...current, draft } : current))}
          onCommit={commit}
          onCancel={cancel}
          onBlockedEdit={blocked}
          revealSignal={revealSignal}
        />
        {docsBeside && (
          <DocumentsPanel
            challenge={challenge}
            selectedRow={selected.row}
            onClose={() => setDocsBeside(false)}
            className="hidden w-72 shrink-0 border-l border-slate-200 @3xl:flex"
          />
        )}
        {docsOverlay && (
          <DocumentsPanel
            challenge={challenge}
            selectedRow={selected.row}
            onClose={() => {
              setDocsOverlay(false);
              gridRef.current?.focus({ preventScroll: true });
            }}
            className="absolute inset-0 z-30 @3xl:hidden"
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        <p aria-live="polite" className="flex min-w-0 items-center gap-1.5 truncate">
          <InfoIcon className="size-3.5 shrink-0" />
          {status}
        </p>
        {hint && hintHidden ? (
          <button
            type="button"
            onClick={() => setHintHidden(false)}
            className="shrink-0 font-medium text-sky-700 hover:underline"
          >
            Show assistance message
          </button>
        ) : (
          <p className="hidden shrink-0 @2xl:block">Enter edit · Esc cancel · = formula</p>
        )}
      </div>

      {dialog && (
        <RoundDialog
          id={id}
          kind={dialog}
          editedCount={editedCount}
          onCancel={() => {
            setDialog(null);
            gridRef.current?.focus({ preventScroll: true });
          }}
          onConfirm={() => {
            setDialog(null);
            if (dialog === "submit") dispatch({ type: "submit", now: performance.now() });
            else dispatch({ type: "openLobby" });
          }}
        />
      )}
    </div>
  );
}

interface FormulaBarProps {
  selected: CellAddress;
  content: string;
  editing: CellEditing | null;
  canEdit: boolean;
  onStartEdit: () => void;
  onDraftChange: (draft: string) => void;
  onCommit: (move: Direction | null) => void;
  onCancel: () => void;
}

function FormulaBar({ selected, content, editing, canEdit, onStartEdit, onDraftChange, onCommit, onCancel }: FormulaBarProps) {
  const keyHandled = useRef(false);
  const isEditingSelected = editing !== null && cellKey(editing.address) === cellKey(selected);

  return (
    <div className="flex items-center border-b border-slate-200 text-[13px]">
      <output
        aria-label="Selected cell"
        className="w-14 shrink-0 border-r border-slate-200 px-2 py-1.5 text-center font-mono text-[12px] text-slate-700"
      >
        {addressLabel(selected)}
      </output>
      <span aria-hidden="true" className="border-r border-slate-200 px-2.5 py-1.5 font-serif text-slate-400 italic">
        fx
      </span>
      <input
        data-sheet-editor=""
        aria-label={canEdit ? `Formula bar, ${addressLabel(selected)}` : `Formula bar, ${addressLabel(selected)} (locked)`}
        value={isEditingSelected ? editing.draft : content}
        readOnly={!isEditingSelected}
        onFocus={() => {
          if (!editing && canEdit) onStartEdit();
        }}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (isEditingSelected) handleEditorKeyDown(event, keyHandled, onCommit, onCancel);
        }}
        onBlur={(event) => {
          if (isEditingSelected) handleEditorBlur(event, keyHandled, onCommit);
        }}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-[12px] text-slate-800 focus:outline-none",
          isEditingSelected && "bg-emerald-50/60",
          !canEdit && "text-slate-500",
        )}
      />
    </div>
  );
}

interface RoundDialogProps {
  id: string;
  kind: "submit" | "abandon";
  editedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function RoundDialog({ id, kind, editedCount, onConfirm, onCancel }: RoundDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const copy =
    kind === "submit"
      ? {
          title: "Submit for review?",
          body: `You've edited ${editedCount} ${editedCount === 1 ? "cell" : "cells"}. Your sheet will be scored as it is now. The clock keeps running while you decide.`,
          confirm: "Submit now",
          cancel: "Keep checking",
        }
      : {
          title: "Abandon this round?",
          body: "Your edits will be discarded and the round won't be scored. The board meeting will proceed with the wrong numbers.",
          confirm: "Abandon round",
          cancel: "Keep working",
        };

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-slate-900/30 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-dialog-title`}
        aria-describedby={`${id}-dialog-body`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full max-w-sm animate-pop-in rounded-xl bg-white p-5 text-slate-800 shadow-xl ring-1 ring-slate-200"
      >
        <h3 id={`${id}-dialog-title`} className="text-sm font-semibold text-slate-900">
          {copy.title}
        </h3>
        <p id={`${id}-dialog-body`} className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
          {copy.body}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white transition-colors",
              kind === "submit" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500",
            )}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
