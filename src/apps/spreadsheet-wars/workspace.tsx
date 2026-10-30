"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, InfoIcon } from "@/components/icons";
import { createSampleSheet } from "@/games/spreadsheet-wars/sample-sheet";
import { addressLabel, getCell, type Cell, type CellAddress } from "@/games/spreadsheet-wars/sheet";
import { formatNumber } from "@/lib/format";
import { SheetMenuBar, SheetToolbar } from "./sheet-chrome";
import { SheetGrid, type GridCellView } from "./sheet-grid";

const SHEET = createSampleSheet();

function displayValue(cell: Cell | undefined): string {
  if (!cell) return "";
  return typeof cell.value === "number" ? formatNumber(cell.value) : cell.value;
}

function cellView(address: CellAddress): GridCellView {
  const cell = getCell(SHEET, address);
  return {
    text: displayValue(cell),
    align: typeof cell?.value === "number" ? "right" : "left",
    tone: cell?.style === "label" ? undefined : cell?.style,
  };
}

interface SpreadsheetWorkspaceProps {
  onBackToLobby: () => void;
  /** Move focus to the grid on mount (when arriving from the lobby). */
  focusOnMount: boolean;
}

/** Read-only practice sheet: a static preview of the Spreadsheet Wars arena. */
export function SpreadsheetWorkspace({ onBackToLobby, focusOnMount }: SpreadsheetWorkspaceProps) {
  const [selected, setSelected] = useState<CellAddress>({ row: 1, col: 1 });
  const gridRef = useRef<HTMLTableElement>(null);
  const selectedCell = getCell(SHEET, selected);

  useEffect(() => {
    if (focusOnMount) gridRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  return (
    <div className="flex h-full min-h-0 animate-view-in flex-col bg-white text-slate-800">
      {/* Document header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-2 py-2">
        <button
          type="button"
          onClick={onBackToLobby}
          aria-label="Back to Spreadsheet Wars lobby"
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white pr-2.5 pl-1.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-emerald-600"
        >
          <ChevronLeftIcon className="size-4" />
          Lobby
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900">Q4_Forecast_FINAL_v7_REAL.grid</p>
          <p className="truncate text-[11px] text-slate-500">Saved to CorpDrive · Last edited by someone in Legal</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-300 ring-inset">
          Read-only
        </span>
      </div>

      <SheetMenuBar />
      <SheetToolbar />

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

      <div role="note" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        <InfoIcon className="mt-px size-3.5 shrink-0" />
        <p>
          <strong className="font-semibold">Practice sheet (read-only).</strong> Explore with the arrow keys. For the real
          thing, play Reconciliation Rush from the lobby.
        </p>
      </div>

      <SheetGrid
        label={`${SHEET.name} practice sheet. Use arrow keys to move the selection.`}
        rowCount={SHEET.rowCount}
        colCount={SHEET.colCount}
        columnClassName={(col) => (col === 0 ? "min-w-56" : "min-w-24")}
        selected={selected}
        onSelect={setSelected}
        getCell={cellView}
        gridRef={gridRef}
      />

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
  );
}
