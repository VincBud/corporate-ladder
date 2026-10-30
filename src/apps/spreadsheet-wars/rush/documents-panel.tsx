"use client";

import { useId, useState } from "react";
import { CloseIcon } from "@/components/icons";
import type { Challenge } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import { cn } from "@/lib/cn";
import { SourceDocumentCard } from "./source-document";

interface DocumentsPanelProps {
  challenge: Challenge;
  /** Row of the active cell; its document is shown by default. */
  selectedRow: number;
  onClose: () => void;
  className?: string;
}

/**
 * Follows the active row: selecting a line item shows its invoice, purchase
 * order or expense report. Summary rows show the finance memo. Any document
 * can also be browsed manually until the selection moves to another row.
 */
export function DocumentsPanel({ challenge, selectedRow, onClose, className }: DocumentsPanelProps) {
  const id = useId();
  const [browsed, setBrowsed] = useState<{ row: number; documentId: string } | null>(null);
  const memo = challenge.documents.find((d) => d.kind === "memo")!;
  const rowDocument = challenge.documents.find((d) => d.row === selectedRow);
  const documentId = browsed?.row === selectedRow ? browsed.documentId : (rowDocument ?? memo).id;
  const doc = challenge.documents.find((d) => d.id === documentId) ?? memo;

  return (
    <aside aria-label="Source documents" className={cn("flex min-h-0 flex-col bg-slate-100 text-slate-800", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h4 className="text-[12px] font-semibold tracking-wide text-slate-600 uppercase">Source documents</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide source documents"
          className="grid size-7 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>

      <div className="border-b border-slate-200 px-3 py-2">
        <label htmlFor={`${id}-browse`} className="sr-only">
          Browse documents
        </label>
        <select
          id={`${id}-browse`}
          value={doc.id}
          onChange={(event) => setBrowsed({ row: selectedRow, documentId: event.target.value })}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px] text-slate-800"
        >
          {challenge.documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.kind === "memo" ? `${d.number} · Reconciliation memo` : `${d.number} · ${d.issuer}`}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-slate-500" aria-live="polite">
          {doc.row !== null ? `Supports row ${doc.row + 1}` : "Applies to subtotal, tax and total"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <SourceDocumentCard document={doc} />
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Record the <strong className="font-semibold text-slate-700">final</strong> figures: net prices, revised and
          delivered quantities, approved expense totals.
        </p>
      </div>
    </aside>
  );
}
