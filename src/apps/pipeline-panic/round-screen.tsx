"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ActivePipelineRound, PipelineMachineAction } from "@/games/pipeline-panic/machine";
import { remainingMs } from "@/games/pipeline-panic/machine";
import { CLAUSES, DISCOUNT_STEPS, type DiscountStep, type Opportunity, type PipelineDecision } from "@/games/pipeline-panic/types";
import { cn } from "@/lib/cn";
import { formatCountdown } from "../spreadsheet-wars/rush/format";
import { useRoundClock } from "../spreadsheet-wars/rush/use-round-clock";
import { cb, decisionLabel, playbookLines, shortDate } from "./format";

interface RoundScreenProps {
  active: ActivePipelineRound;
  dispatch: (action: PipelineMachineAction) => void;
  /** Verified rounds: asks the server for the hint. Local rounds compute it in the browser. */
  onRequestHint: () => Promise<void>;
  /** Overrides the Exit confirmation (e.g. ranked daily rounds keep running when you leave). */
  exitCopy?: { title: string; body: string; confirm: string };
}

type Dialog = "submit" | "exit" | null;

const ACTIONS: { key: string; action: PipelineDecision["action"]; label: string; checked: string }[] = [
  { key: "1", action: "close", label: "Close at list", checked: "border-emerald-500 bg-emerald-50 text-emerald-900" },
  { key: "2", action: "discount", label: "Close with discount", checked: "border-sky-500 bg-sky-50 text-sky-900" },
  { key: "3", action: "defer", label: "Next quarter", checked: "border-amber-500 bg-amber-50 text-amber-900" },
  { key: "4", action: "reject", label: "Disqualify", checked: "border-rose-500 bg-rose-50 text-rose-900" },
];

const CHIP: Record<PipelineDecision["action"] | "none", string> = {
  close: "bg-emerald-100 text-emerald-800",
  discount: "bg-sky-100 text-sky-800",
  defer: "bg-amber-100 text-amber-800",
  reject: "bg-rose-100 text-rose-800",
  none: "bg-slate-100 text-slate-500",
};

export function PipelineRoundScreen({ active, dispatch, onRequestHint, exitCopy }: RoundScreenProps) {
  const id = useId();
  const { round, decisions } = active;
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [hintPending, setHintPending] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [showPlaybook, setShowPlaybook] = useState(false);
  const [discountChoice, setDiscountChoice] = useState<DiscountStep>(5);
  const [status, setStatus] = useState("Round started. Work through the pipeline.");

  const now = useRoundClock(active.startedAt, active.durationMs, (time) => dispatch({ type: "finish", now: time, outcome: "timedOut" }));
  const remaining = remainingMs(active, now);
  const expired = remaining === 0;

  const opportunities = round.opportunities;
  const index = Math.max(0, opportunities.findIndex((o) => o.id === active.selectedId));
  const selected = opportunities[index];
  const decided = Object.keys(decisions).length;
  const closing = Object.values(decisions).filter((d) => d.action === "close" || d.action === "discount").length;
  const current = decisions[selected.id];

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
    // Focus only on mount; later selection changes keep focus where the player is.
  }, []);

  const select = (next: number) => {
    const target = opportunities[(next + opportunities.length) % opportunities.length];
    dispatch({ type: "select", id: target.id });
  };

  const decide = (decision: PipelineDecision | null) => {
    if (expired) return;
    dispatch({ type: "decide", id: selected.id, decision });
    setStatus(`${selected.account}: ${decision ? decisionLabel(decision) : "decision cleared"}.`);
  };

  const choose = (action: PipelineDecision["action"]) => decide(action === "discount" ? { action, discount: discountChoice } : { action });

  const setDiscount = (step: DiscountStep) => {
    setDiscountChoice(step);
    if (current?.action === "discount") decide({ action: "discount", discount: step });
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (dialog || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).tagName === "SELECT") return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "arrowdown") select(index + 1);
    else if (key === "k" || key === "arrowup") select(index - 1);
    else if (ACTIONS.some((a) => a.key === key)) choose(ACTIONS.find((a) => a.key === key)!.action);
    else if (key === "0" || key === "backspace") decide(null);
    else if (key === "[" || key === "]") {
      const position = DISCOUNT_STEPS.indexOf(discountChoice);
      const next = DISCOUNT_STEPS[Math.min(DISCOUNT_STEPS.length - 1, Math.max(0, position + (key === "]" ? 1 : -1)))];
      setDiscount(next);
    } else return;
    event.preventDefault();
  }

  async function requestHint() {
    setHintPending(true);
    setHintError(null);
    try {
      await onRequestHint();
    } catch (error) {
      setHintError(error instanceof Error ? error.message : "Couldn't reach Sales Operations.");
    } finally {
      setHintPending(false);
    }
  }

  const urgency = remaining <= 10_000 ? "critical" : remaining <= 30_000 ? "warning" : "normal";
  const announcement = remaining <= 10_000 ? "10 seconds remaining." : remaining <= 30_000 ? "30 seconds remaining." : remaining <= 60_000 ? "1 minute remaining." : "";
  const hint = active.hint;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-slate-50 text-slate-800" onKeyDown={onKeyDown}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900">
            Pipeline Panic
            {active.mode === "verified" && (
              <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-emerald-800">Verified</span>
            )}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            DealDesk CRM · {round.quarterLabel} pipeline · {opportunities.length} opportunities
          </p>
        </div>
        <p className="text-[12px] text-slate-600 tabular-nums">
          <span className="font-semibold text-slate-900">{decided}</span>/{opportunities.length} decided ·{" "}
          <span className={cn("font-semibold", closing > round.playbook.closingSlots ? "text-rose-700" : "text-slate-900")}>{closing}</span>/
          {round.playbook.closingSlots} closing slots
        </p>
        <div
          role="timer"
          aria-label={`Time remaining ${formatCountdown(remaining)}`}
          className={cn(
            "rounded-md px-2.5 py-1 font-mono text-lg leading-none font-semibold tabular-nums ring-1 ring-inset",
            urgency === "critical" ? "bg-rose-50 text-rose-700 ring-rose-200" : urgency === "warning" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-white text-slate-900 ring-slate-200",
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
            onClick={() => void requestHint()}
            disabled={expired || hint !== null || hintPending}
            title={hint ? "Assistance already used this round" : "Sales Operations points you to one opportunity worth another look. The clock keeps running."}
            className="h-8 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-[12px] font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
          >
            {hintPending ? "Requesting…" : `Request Assistance (${hint ? 0 : 1}/1)`}
          </button>
          <button
            type="button"
            onClick={() => setShowPlaybook((open) => !open)}
            aria-pressed={showPlaybook}
            aria-controls={`${id}-playbook`}
            className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-100 aria-pressed:bg-slate-200/70 @5xl:hidden"
          >
            Playbook
          </button>
          <button type="button" onClick={() => setDialog("exit")} className="h-8 rounded-md px-2.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800">
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
      </header>

      <div aria-hidden="true" className="h-1 bg-slate-200">
        <div
          className={cn("h-full motion-safe:transition-[width] motion-safe:duration-200", urgency === "critical" ? "bg-rose-500" : urgency === "warning" ? "bg-amber-500" : "bg-emerald-500")}
          style={{ width: `${(remaining / active.durationMs) * 100}%` }}
        />
      </div>

      {hint && (
        <div role="note" aria-label="Sales Operations hint" className="flex flex-wrap items-center gap-2 border-b border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-900">
          <span className="font-semibold">Sales Operations:</span>
          <span className="min-w-0 flex-1">{hint.message}</span>
          {hint.opportunityId && (
            <button type="button" onClick={() => dispatch({ type: "select", id: hint.opportunityId! })} className="rounded-md bg-white px-2 py-0.5 font-medium ring-1 ring-sky-200 hover:bg-sky-100">
              Show opportunity
            </button>
          )}
        </div>
      )}
      {hintError && (
        <p role="alert" className="border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] text-rose-800">
          {hintError}
        </p>
      )}

      {showPlaybook && (
        <aside id={`${id}-playbook`} aria-label="Sales playbook" className="max-h-56 overflow-y-auto border-b border-slate-200 bg-amber-50/60 p-3 text-[12px] @5xl:hidden">
          <PlaybookPanel playbook={round.playbook} />
        </aside>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-y-auto @3xl:grid-cols-[17rem_1fr] @3xl:grid-rows-1 @3xl:overflow-hidden @5xl:grid-cols-[17rem_1fr_16rem]">
        <nav aria-label="Pipeline" className="border-b border-slate-200 bg-white @3xl:overflow-y-auto @3xl:border-r @3xl:border-b-0">
          <p className="px-3 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">Open opportunities</p>
          <ul ref={listRef} className="pb-2">
            {opportunities.map((o, i) => {
              const decision = decisions[o.id];
              const isSelected = o.id === selected.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => {
                      dispatch({ type: "select", id: o.id });
                      detailRef.current?.scrollIntoView({ block: "nearest" });
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors",
                      isSelected ? "border-emerald-500 bg-emerald-50/70" : "border-transparent hover:bg-slate-50",
                      hint?.opportunityId === o.id && "ring-1 ring-sky-300 ring-inset",
                    )}
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-[10px] text-slate-400 tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-slate-900">{o.account}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {cb(o.listPrice)} · close {shortDate(o.closeDate)}
                      </span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", CHIP[decision?.action ?? "none"])}>{decisionLabel(decision)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section ref={detailRef} aria-labelledby={`${id}-account`} className="min-w-0 space-y-3 p-3 @3xl:overflow-y-auto @xl:p-4">
          <OpportunityDetail id={id} opportunity={selected} position={index + 1} total={opportunities.length} />

          <div role="radiogroup" aria-label={`Decision for ${selected.account}`} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Your decision</p>
            <div className="grid grid-cols-2 gap-1.5 @2xl:grid-cols-4">
              {ACTIONS.map((a) => {
                const checked = current?.action === a.action;
                return (
                  <button
                    key={a.action}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={expired}
                    onClick={() => (checked ? decide(null) : choose(a.action))}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors disabled:opacity-50",
                      checked ? a.checked : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    {a.label}
                    <kbd className="rounded border border-slate-200 bg-slate-50 px-1 text-[10px] text-slate-500">{a.key}</kbd>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-slate-500" id={`${id}-discount`}>
                Discount
              </span>
              <div role="group" aria-labelledby={`${id}-discount`} className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                {DISCOUNT_STEPS.map((step) => {
                  const active = (current?.action === "discount" ? current.discount : discountChoice) === step;
                  return (
                    <button
                      key={step}
                      type="button"
                      aria-pressed={active}
                      disabled={expired}
                      onClick={() => setDiscount(step)}
                      className={cn("rounded px-2 py-0.5 tabular-nums", active ? "bg-white font-semibold text-sky-800 shadow-sm ring-1 ring-sky-200" : "text-slate-600 hover:text-slate-900")}
                    >
                      {step}%
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-slate-400">
                <kbd>[</kbd> <kbd>]</kbd> change · <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>0</kbd> clear
              </span>
            </div>
          </div>
          <p className="sr-only" aria-live="polite">
            {status}
          </p>
        </section>

        <aside aria-label="Sales playbook" className="hidden border-l border-slate-200 bg-amber-50/60 p-3 text-[12px] @5xl:block @5xl:overflow-y-auto">
          <PlaybookPanel playbook={round.playbook} />
        </aside>
      </div>

      {dialog && (
        <ConfirmDialog
          id={id}
          title={dialog === "submit" ? "Submit your pipeline?" : (exitCopy?.title ?? "Leave this round?")}
          body={
            dialog === "submit"
              ? decided < opportunities.length
                ? `${opportunities.length - decided} opportunities have no decision and will score nothing.`
                : "Your decisions are final once submitted."
              : (exitCopy?.body ?? "Nothing will be scored and the round can't be resumed.")
          }
          confirmLabel={dialog === "submit" ? "Submit now" : (exitCopy?.confirm ?? "Leave round")}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            if (dialog === "submit") dispatch({ type: "finish", now: performance.now(), outcome: "completed" });
            else dispatch({ type: "abandon" });
          }}
        />
      )}
    </div>
  );
}

function PlaybookPanel({ playbook }: { playbook: ActivePipelineRound["round"]["playbook"] }) {
  return (
    <>
      <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-amber-900 uppercase">Sales playbook</p>
      <dl className="grid gap-x-4 gap-y-1.5 @xl:grid-cols-2 @5xl:grid-cols-1">
        {playbookLines(playbook).map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-amber-900/70">{label}</dt>
            <dd className="font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-amber-900/70">Qualified = budget confirmed and a decision maker engaged. Close the most valuable deals that fit.</p>
    </>
  );
}

function OpportunityDetail({ id, opportunity: o, position, total }: { id: string; opportunity: Opportunity; position: number; total: number }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] text-slate-500">
            Opportunity {position} of {total} · {o.industry}
          </p>
          <h3 id={`${id}-account`} className="text-base font-semibold text-slate-900">
            {o.account}
          </h3>
          <p className="text-[12px] text-slate-600">{o.product}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Stage: {o.stage}</span>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-2">
        <section aria-label="CRM record" className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">CRM record</h4>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-slate-500">Contact</dt>
            <dd>
              {o.contact.name}
              <span className="block text-[11px] text-slate-500">{o.contact.title}</span>
            </dd>
            <dt className="text-slate-500">List price</dt>
            <dd className="font-semibold tabular-nums">{cb(o.listPrice)}</dd>
            <dt className="text-slate-500">Delivery cost</dt>
            <dd className="tabular-nums">{cb(o.deliveryCost)}</dd>
            <dt className="text-slate-500">Expected close</dt>
            <dd className="tabular-nums">{shortDate(o.closeDate)}</dd>
          </dl>
        </section>

        <section aria-label="Client email" className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Client email</h4>
          <p className="text-[11px] text-slate-500">
            From {o.email.from} · <span className="italic">{o.email.subject}</span>
          </p>
          <div className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed">
            {o.email.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>

        <section aria-label="Discovery notes" className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Discovery notes</h4>
          <ul className="list-disc space-y-1 pl-4 text-[12.5px]">
            {o.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>

        <section aria-label="Contract redlines" className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Contract redlines</h4>
          <p className="text-[12.5px]">
            Payment terms: <span className="font-semibold tabular-nums">net {o.paymentDays} days</span>
          </p>
          {o.clauses.length === 0 ? (
            <p className="mt-1 text-[12px] text-slate-500">No other changes to the standard contract.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[12.5px]">
              {o.clauses.map((clause) => (
                <li key={clause}>
                  <span className="font-medium">{CLAUSES[clause].label}:</span> <span className="text-slate-600">{CLAUSES[clause].text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function ConfirmDialog({
  id,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-slate-900/30 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-dialog-title`}
        aria-describedby={`${id}-dialog-body`}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") onCancel();
        }}
        className="w-full max-w-sm motion-safe:animate-pop-in rounded-xl bg-white p-5 text-slate-800 shadow-xl ring-1 ring-slate-200"
      >
        <h3 id={`${id}-dialog-title`} className="text-sm font-semibold text-slate-900">
          {title}
        </h3>
        <p id={`${id}-dialog-body`} className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
          {body}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
            Keep working
          </button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-500">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
