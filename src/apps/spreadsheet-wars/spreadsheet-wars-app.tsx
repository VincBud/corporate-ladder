"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { InfoIcon, LockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { PLANNED_MODES } from "@/games/spreadsheet-wars/modes";
import { createSampleSheet } from "@/games/spreadsheet-wars/sample-sheet";
import {
  addressLabel,
  clampAddress,
  columnLabel,
  getCell,
  moveAddress,
  type Cell,
  type CellAddress,
  type Direction,
} from "@/games/spreadsheet-wars/sheet";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

const SHEET = createSampleSheet();
const ROWS = Array.from({ length: SHEET.rowCount }, (_, i) => i);
const COLS = Array.from({ length: SHEET.colCount }, (_, i) => i);

const HEADER_HEIGHT = 28;
const ROW_HEADER_WIDTH = 48;

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "down",
};

const CELL_STYLES: Record<NonNullable<Cell["style"]>, string> = {
  header: "bg-slate-50 font-semibold text-slate-900",
  label: "text-slate-700",
  total: "font-semibold text-slate-900",
  note: "italic text-amber-700",
};

const TOOLBAR_GROUPS = [
  ["Undo", "Redo"],
  ["Bold", "Italic", "Underline"],
  ["Currency", "Percent", "AutoSum"],
] as const;

const TOOLBAR_GLYPHS: Record<(typeof TOOLBAR_GROUPS)[number][number], string> = {
  Undo: "↶",
  Redo: "↷",
  Bold: "B",
  Italic: "I",
  Underline: "U",
  Currency: "¤",
  Percent: "%",
  AutoSum: "Σ",
};

function displayValue(cell: Cell | undefined): string {
  if (!cell) return "";
  return typeof cell.value === "number" ? formatNumber(cell.value) : cell.value;
}

export function SpreadsheetWarsApp() {
  const [selected, setSelected] = useState<CellAddress>({ row: 1, col: 1 });
  const gridId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeCellId = `${gridId}-${selected.row}-${selected.col}`;
  const selectedCell = getCell(SHEET, selected);

  // Keep the active cell visible below the sticky headers.
  useEffect(() => {
    const scroller = scrollRef.current;
    const cell = document.getElementById(activeCellId);
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
  }, [activeCellId]);

  function handleGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    let next: CellAddress | null = null;
    const direction = KEY_DIRECTIONS[event.key];

    if (direction) {
      next = moveAddress(SHEET, selected, event.key === "Enter" && event.shiftKey ? "up" : direction);
    } else if (event.key === "Home") {
      next = event.ctrlKey || event.metaKey ? { row: 0, col: 0 } : { row: selected.row, col: 0 };
    } else if (event.key === "End") {
      next = clampAddress(SHEET, { row: selected.row, col: SHEET.colCount - 1 });
    }

    if (next) {
      event.preventDefault();
      setSelected(next);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col bg-white text-slate-800">
        {/* Document header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-900">Q4_Forecast_FINAL_v7_REAL.grid</p>
            <p className="truncate text-[11px] text-slate-500">Saved to CorpDrive · Last edited by someone in Legal</p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-300 ring-inset">
            Preview build
          </span>
        </div>

        {/* Menu + toolbar (visual only) */}
        <div className="flex gap-4 overflow-x-auto border-b border-slate-200 px-3 py-1.5 text-[12px] text-slate-600" aria-hidden="true">
          {["File", "Edit", "View", "Insert", "Format", "Data", "Tools", "Help"].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div role="toolbar" aria-label="Formatting (not available in preview)" className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-2 py-1.5">
          <span className="mr-1 rounded border border-slate-200 px-2 py-1 text-[12px] whitespace-nowrap text-slate-400">Corporate Sans · 11</span>
          {TOOLBAR_GROUPS.map((group, i) => (
            <div key={i} className="flex items-center gap-0.5 border-l border-slate-200 pl-1">
              {group.map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  aria-label={label}
                  title={`${label} — available when gameplay ships`}
                  className="grid size-7 place-items-center rounded text-[13px] font-semibold text-slate-400"
                >
                  {TOOLBAR_GLYPHS[label]}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Formula bar */}
        <div className="flex items-center border-b border-slate-200 text-[13px]">
          <output
            aria-label="Selected cell"
            className="w-16 shrink-0 border-r border-slate-200 px-2 py-1.5 text-center font-mono text-[12px] text-slate-700"
          >
            {addressLabel(selected)}
          </output>
          <span aria-hidden="true" className="border-r border-slate-200 px-2.5 py-1.5 font-serif text-slate-400 italic">
            fx
          </span>
          <output aria-label="Cell contents" className="min-w-0 flex-1 truncate px-2 py-1.5 font-mono text-[12px] text-slate-800">
            {selectedCell?.formula ?? displayValue(selectedCell)}
          </output>
        </div>

        {/* Not-implemented disclosure */}
        <div role="note" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <InfoIcon className="mt-px size-3.5 shrink-0" />
          <p>
            <strong className="font-semibold">Gameplay isn&apos;t implemented yet.</strong> This is a static preview of the
            Spreadsheet Wars arena. Use the arrow keys to move between cells; formula duels arrive in a future update.
          </p>
        </div>

        {/* Grid */}
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <table
            role="grid"
            aria-label={`${SHEET.name} preview. Use arrow keys to move the selection.`}
            aria-readonly="true"
            aria-activedescendant={activeCellId}
            tabIndex={0}
            onKeyDown={handleGridKeyDown}
            className="group border-separate border-spacing-0 text-[13px] focus-visible:outline-none"
          >
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 h-7 w-12 min-w-12 border-r border-b border-slate-200 bg-slate-100" />
                {COLS.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 h-7 border-r border-b border-slate-200 text-[11px] font-medium",
                      col === 0 ? "min-w-56" : "min-w-24",
                      col === selected.col ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {columnLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
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
                  {COLS.map((col) => {
                    const cell = getCell(SHEET, { row, col });
                    const isSelected = row === selected.row && col === selected.col;
                    return (
                      <td
                        key={col}
                        id={`${gridId}-${row}-${col}`}
                        aria-selected={isSelected}
                        onClick={() => setSelected({ row, col })}
                        className={cn(
                          "h-7 cursor-cell border-r border-b border-slate-100 px-2 whitespace-nowrap",
                          typeof cell?.value === "number" && "text-right tabular-nums",
                          cell?.style && CELL_STYLES[cell.style],
                          isSelected &&
                            "bg-emerald-50 outline-2 -outline-offset-2 outline-emerald-600 group-focus-visible:outline-emerald-700",
                        )}
                      >
                        {displayValue(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sheet tabs + status */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-500">
          <div className="flex min-w-0 overflow-x-auto" aria-hidden="true">
            <span className="border-x border-b-2 border-x-slate-200 border-b-emerald-600 bg-white px-3 py-1.5 font-medium whitespace-nowrap text-slate-800">
              {SHEET.name}
            </span>
            <span className="px-3 py-1.5 whitespace-nowrap">{SHEET.name} (2)</span>
            <span className="px-3 py-1.5 whitespace-nowrap">DO NOT OPEN</span>
          </div>
          <span className="shrink-0 py-1.5 tabular-nums">
            {typeof selectedCell?.value === "number" ? `Sum: ${formatNumber(selectedCell.value)}` : "Ready"}
          </span>
        </div>
      </div>

      {/* Match lobby (future gameplay) */}
      <aside aria-labelledby={`${gridId}-lobby`} className="hidden w-64 shrink-0 flex-col gap-3 border-l border-line bg-surface p-4 @4xl:flex">
        <div className="flex items-center justify-between">
          <h3 id={`${gridId}-lobby`} className="text-sm font-semibold">
            Match lobby
          </h3>
          <Badge tone="warning">Coming soon</Badge>
        </div>
        <p className="text-xs leading-relaxed text-fg-muted">Planned modes. None are playable yet.</p>
        <ul className="space-y-2">
          {PLANNED_MODES.map((mode) => (
            <li key={mode.id} className="rounded-lg border border-line bg-surface-raised/60 p-3">
              <p className="text-[13px] font-medium">{mode.name}</p>
              <p className="text-[11px] text-accent">{mode.format}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{mode.description}</p>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled
          className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-[13px] font-medium text-fg-subtle"
        >
          <LockIcon className="size-4" />
          Find match
        </button>
      </aside>
    </div>
  );
}
