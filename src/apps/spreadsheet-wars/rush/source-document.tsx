import type { SourceDocument } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/cn";

const STAMP_TONES: Record<string, string> = {
  APPROVED: "border-emerald-600/70 text-emerald-700",
  REVISED: "border-amber-600/70 text-amber-700",
  "PARTIAL DELIVERY": "border-amber-600/70 text-amber-700",
};

/** A source document rendered as paperwork. Shows facts only, never which sheet cells are wrong. */
export function SourceDocumentCard({ document: doc, className }: { document: SourceDocument; className?: string }) {
  return (
    <article
      aria-label={`${doc.title} ${doc.number}`}
      className={cn("relative rounded-md bg-white p-4 text-slate-800 shadow-sm ring-1 ring-slate-200", className)}
    >
      {doc.stamp && (
        <span
          aria-label={`Stamped ${doc.stamp.toLowerCase()}`}
          className={cn(
            "absolute top-3 right-3 rotate-[-6deg] rounded border-2 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.15em]",
            STAMP_TONES[doc.stamp] ?? "border-slate-500 text-slate-600",
          )}
        >
          {doc.stamp}
        </span>
      )}
      <p className="text-[10px] font-medium tracking-[0.2em] text-slate-400 uppercase">{doc.title}</p>
      <p className="mt-0.5 pr-20 text-sm font-semibold text-slate-900">{doc.issuer}</p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-slate-400">No.</dt>
        <dd className="text-right font-mono text-slate-700">{doc.number}</dd>
        <dt className="text-slate-400">Date</dt>
        <dd className="text-right text-slate-700">{doc.date}</dd>
        {doc.kind !== "memo" && (
          <>
            <dt className="text-slate-400">Bill to</dt>
            <dd className="text-right text-slate-700">{BRAND.company}</dd>
          </>
        )}
      </dl>

      <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-[12px] font-medium text-slate-700">{doc.subject}</p>

      <table className="mt-1.5 w-full text-[12px]">
        <tbody>
          {doc.lines.map((line, i) => (
            <tr key={i} className={cn(line.tone === "final" && "font-semibold text-slate-900")}>
              <th
                scope="row"
                className={cn(
                  "py-0.5 pr-3 text-left align-top font-normal",
                  line.tone === "struck" && "text-slate-400 line-through",
                  line.tone === "muted" && "text-slate-500",
                  line.tone === "final" && "font-semibold",
                )}
              >
                {line.label}
              </th>
              <td
                className={cn(
                  "py-0.5 text-right align-top font-mono tabular-nums",
                  line.tone === "struck" && "text-slate-400 line-through",
                  line.tone === "muted" && "text-slate-500",
                )}
              >
                {line.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {doc.footnote && <p className="mt-2 text-[11px] text-slate-500 italic">{doc.footnote}</p>}
    </article>
  );
}
