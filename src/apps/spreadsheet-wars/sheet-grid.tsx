"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { clampAddress, columnLabel, moveAddress, type CellAddress, type Direction } from "@/games/spreadsheet-wars/sheet";
import { cn } from "@/lib/cn";

export interface GridCellView {
  text: string;
  align?: "left" | "right";
  tone?: "header" | "label" | "total" | "note" | "error" | "muted";
  /** The player changed this cell (shown as a corner marker). */
  edited?: boolean;
  /** Changes whenever the cell should replay its "committed" flash. */
  flashKey?: number;
}

export interface CellEditing {
  address: CellAddress;
  draft: string;
  /** Where the caret lives: inside the cell, or in the formula bar. */
  origin: "cell" | "bar";
}

interface SheetGridProps {
  label: string;
  rowCount: number;
  colCount: number;
  columnClassName: (col: number) => string;
  selected: CellAddress;
  onSelect: (address: CellAddress) => void;
  getCell: (address: CellAddress) => GridCellView;
  gridRef?: RefObject<HTMLTableElement | null>;
  /** Editing support. Omit for read-only grids. */
  canEdit?: (address: CellAddress) => boolean;
  editing?: CellEditing | null;
  onStartEdit?: (address: CellAddress, draft: string | null) => void;
  onDraftChange?: (draft: string) => void;
  onCommit?: (move: Direction | null) => void;
  onCancel?: () => void;
  /** Called when the player tries to edit a locked cell. */
  onBlockedEdit?: (address: CellAddress) => void;
  /** Increment to scroll the current selection into view (e.g. after jumping to a row). */
  revealSignal?: number;
}

const HEADER_HEIGHT = 28;
const ROW_HEADER_WIDTH = 48;

const NAV_KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const TONES: Record<NonNullable<GridCellView["tone"]>, string> = {
  header: "bg-slate-50 font-semibold text-slate-900",
  label: "font-medium text-slate-600",
  total: "font-semibold text-slate-900",
  note: "italic text-amber-700",
  error: "font-medium text-rose-600",
  muted: "text-slate-500",
};

/**
 * Shared editor key handling for the in-cell editor and the formula bar.
 * `handled` suppresses the blur-commit that follows a key-driven commit/cancel.
 */
export function handleEditorKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  handled: RefObject<boolean>,
  onCommit: (move: Direction | null) => void,
  onCancel: () => void,
) {
  if (event.key === "Enter") {
    event.preventDefault();
    handled.current = true;
    onCommit(event.shiftKey ? "up" : "down");
  } else if (event.key === "Tab") {
    event.preventDefault();
    handled.current = true;
    onCommit(event.shiftKey ? "left" : "right");
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    handled.current = true;
    onCancel();
  }
}

/** Commits on blur unless focus moves to the other editor or a key already handled it. */
export function handleEditorBlur(
  event: FocusEvent<HTMLInputElement>,
  handled: RefObject<boolean>,
  onCommit: (move: Direction | null) => void,
) {
  if (handled.current) {
    handled.current = false;
    return;
  }
  if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.sheetEditor !== undefined) return;
  onCommit(null);
}

export function SheetGrid({
  label,
  rowCount,
  colCount,
  columnClassName,
  selected,
  onSelect,
  getCell,
  gridRef,
  canEdit,
  editing,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  onBlockedEdit,
  revealSignal,
}: SheetGridProps) {
  const gridId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const keyHandled = useRef(false);
  const cellDomId = ({ row, col }: CellAddress) => `${gridId}-${row}-${col}`;
  const editingInCell = editing?.origin === "cell" ? editing.address : null;
  const editingKey = editingInCell ? cellDomId(editingInCell) : null;

  // Focus the in-cell editor when editing starts there.
  useEffect(() => {
    const input = editorRef.current;
    if (!editingKey || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editingKey]);

  /** Keeps a cell visible below the sticky headers (keyboard navigation only). */
  function scrollCellIntoView(address: CellAddress) {
    const scroller = scrollRef.current;
    const cell = document.getElementById(cellDomId(address));
    if (!scroller || !cell) return;
    if (cell.offsetTop - HEADER_HEIGHT < scroller.scrollTop) {
      scroller.scrollTop = cell.offsetTop - HEADER_HEIGHT;
    } else if (cell.offsetTop + cell.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = cell.offsetTop + cell.offsetHeight - scroller.clientHeight;
    }
    if (cell.offsetLeft - ROW_HEADER_WIDTH < scroller.scrollLeft) {
      scroller.scrollLeft = cell.offsetLeft - ROW_HEADER_WIDTH;
    } else if (cell.offsetLeft + cell.offsetWidth > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = cell.offsetLeft + cell.offsetWidth - scroller.clientWidth;
    }
  }

  const revealSelected = useEffectEvent(() => scrollCellIntoView(selected));
  useEffect(() => {
    if (revealSignal) revealSelected();
  }, [revealSignal]);

  const bounds = { rowCount, colCount, name: label, cells: new Map() };
  const editable = (address: CellAddress) => Boolean(onStartEdit && canEdit?.(address));

  function moveTo(next: CellAddress) {
    onSelect(next);
    // Every cell is always rendered, so the target exists before the re-render.
    scrollCellIntoView(next);
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (editing) return;
    const { key } = event;
    const direction = NAV_KEYS[key];

    if (direction) {
      event.preventDefault();
      moveTo(moveAddress(bounds, selected, direction));
    } else if (key === "Home") {
      event.preventDefault();
      moveTo(event.ctrlKey || event.metaKey ? { row: 0, col: 0 } : { row: selected.row, col: 0 });
    } else if (key === "End") {
      event.preventDefault();
      moveTo(clampAddress(bounds, { row: selected.row, col: colCount - 1 }));
    } else if (key === "Enter" || key === "F2") {
      event.preventDefault();
      if (editable(selected)) onStartEdit?.(selected, null);
      else if (key === "Enter") moveTo(moveAddress(bounds, selected, event.shiftKey ? "up" : "down"));
      else onBlockedEdit?.(selected);
    } else if (key === "Backspace" || key === "Delete" || (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      if (!onStartEdit) return;
      event.preventDefault();
      if (editable(selected)) onStartEdit(selected, key.length === 1 ? key : "");
      else onBlockedEdit?.(selected);
    }
  }

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-white">
      <table
        ref={gridRef}
        role="grid"
        aria-label={label}
        aria-readonly={onStartEdit ? undefined : "true"}
        aria-activedescendant={cellDomId(selected)}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="group border-separate border-spacing-0 text-[13px] text-slate-800 focus-visible:outline-none"
      >
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 h-7 w-12 min-w-12 border-r border-b border-slate-200 bg-slate-100" />
            {Array.from({ length: colCount }, (_, col) => (
              <th
                key={col}
                scope="col"
                className={cn(
                  "sticky top-0 z-10 h-7 border-r border-b border-slate-200 text-[11px] font-medium",
                  columnClassName(col),
                  col === selected.col ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500",
                )}
              >
                {columnLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, row) => (
            <tr key={row}>
              <th
                scope="row"
                className={cn(
                  "sticky left-0 z-10 h-7 border-r border-b border-slate-200 text-[11px] font-medium",
                  row === selected.row ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500",
                )}
              >
                {row + 1}
              </th>
              {Array.from({ length: colCount }, (_, col) => {
                const address = { row, col };
                const view = getCell(address);
                const isSelected = row === selected.row && col === selected.col;
                const isEditingHere = editingInCell?.row === row && editingInCell.col === col;
                return (
                  <td
                    key={col}
                    id={cellDomId(address)}
                    aria-selected={isSelected}
                    aria-readonly={onStartEdit && !editable(address) ? true : undefined}
                    onClick={() => onSelect(address)}
                    onDoubleClick={() => {
                      if (editable(address)) onStartEdit?.(address, null);
                      else if (onStartEdit) onBlockedEdit?.(address);
                    }}
                    className={cn(
                      "relative h-7 cursor-cell border-r border-b border-slate-100 px-2 whitespace-nowrap",
                      view.align === "right" && "text-right tabular-nums",
                      view.tone && TONES[view.tone],
                      isSelected &&
                        "bg-emerald-50 outline-2 -outline-offset-2 outline-emerald-600 group-focus-visible:outline-emerald-700",
                    )}
                  >
                    {view.edited && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-0 right-0 border-t-[7px] border-l-[7px] border-t-sky-500 border-l-transparent"
                      />
                    )}
                    {isEditingHere && editing ? (
                      <input
                        ref={editorRef}
                        data-sheet-editor=""
                        aria-label={`Edit cell ${columnLabel(col)}${row + 1}`}
                        value={editing.draft}
                        onChange={(event) => onDraftChange?.(event.target.value)}
                        onKeyDown={(event) => handleEditorKeyDown(event, keyHandled, onCommit!, onCancel!)}
                        onBlur={(event) => handleEditorBlur(event, keyHandled, onCommit!)}
                        spellCheck={false}
                        autoComplete="off"
                        className="absolute inset-0 z-10 w-full bg-white px-2 font-mono text-[12.5px] text-slate-900 outline-2 -outline-offset-2 outline-emerald-600"
                      />
                    ) : (
                      <span key={view.flashKey} className={cn("block", view.flashKey !== undefined && "animate-cell-commit")}>
                        {view.text}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
