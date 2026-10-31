"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { GUEST_SCOPE } from "@/performance/career-scope";
import type { CareerState } from "@/performance/career-store";
import { getCareerStore, useActiveCareerScope, useCareerScope } from "@/performance/use-career";
import { api } from "@/services/api-client";

const IMPORT_BATCH = 200;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * For signed-in players: offers to import this browser's guest history as
 * legacy practice, and lists what was imported. Guest rounds were scored in
 * the browser, so they can't be verified and never count toward XP or ranks.
 * The browser copy is never deleted.
 */
export function LegacyPractice({ career }: { career: CareerState }) {
  const guest = useCareerScope(GUEST_SCOPE);
  const scope = useActiveCareerScope();
  const [status, setStatus] = useState<{ kind: "idle" | "importing" | "done" | "error" | "dismissed"; message?: string }>({ kind: "idle" });

  const importedIds = new Set(career.legacyRecords.map((l) => l.localId));
  const pending = guest.records.filter((record) => !importedIds.has(record.id));

  async function importAll() {
    setStatus({ kind: "importing" });
    try {
      let imported = 0;
      for (let i = 0; i < pending.length; i += IMPORT_BATCH) {
        imported += (await api.importLegacy(pending.slice(i, i + IMPORT_BATCH))).imported;
      }
      if (scope) await getCareerStore(scope).load();
      setStatus({ kind: "done", message: `${imported} ${imported === 1 ? "round" : "rounds"} added as legacy practice.` });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Import failed. Your local history is unchanged." });
    }
  }

  return (
    <div className="space-y-3">
      {pending.length > 0 && status.kind !== "dismissed" && (
        <section aria-label="Import guest history" className="rounded-lg border border-accent/30 bg-accent-soft p-3 text-xs">
          <p className="font-medium text-fg">
            This browser has {pending.length} guest {pending.length === 1 ? "round" : "rounds"} from before you signed in.
          </p>
          <p className="mt-1 leading-relaxed text-fg-muted">
            Guest rounds were scored in the browser, so the server can&apos;t verify them. You can keep them in your account
            as <strong className="text-fg">legacy practice</strong>: visible to you, but never counted toward Corporate XP,
            rank or rankings. Your browser copy stays untouched, and importing again is safe.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void importAll()}
              disabled={status.kind === "importing"}
              className="rounded-md bg-accent-strong px-2.5 py-1 font-medium text-white transition-colors hover:bg-accent disabled:opacity-50"
            >
              {status.kind === "importing" ? "Importing…" : "Import as legacy practice"}
            </button>
            <button
              type="button"
              onClick={() => setStatus({ kind: "dismissed" })}
              className="rounded-md px-2.5 py-1 font-medium text-fg-muted transition-colors hover:bg-white/6"
            >
              Not now
            </button>
          </div>
        </section>
      )}
      {(status.kind === "done" || status.kind === "error") && (
        <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "text-xs text-rose-300" : "text-xs text-success"}>
          {status.message}
        </p>
      )}

      {career.legacyRecords.length > 0 && (
        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
            Legacy practice (unverified) · {career.legacyRecords.length} {career.legacyRecords.length === 1 ? "round" : "rounds"}
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {career.legacyRecords.slice(0, 20).map(({ localId, record }) => (
              <li key={localId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-fg-muted">
                <span className="w-24 shrink-0 tabular-nums">{dateFormat.format(new Date(record.completedAt))}</span>
                <span className="min-w-0 flex-1 truncate">{record.department}</span>
                <span className="tabular-nums">
                  {formatNumber(record.score)} / {formatNumber(record.maxScore)}
                </span>
                <Badge>Unverified · no XP</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
