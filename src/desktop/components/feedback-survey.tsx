"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CloseIcon } from "@/components/icons";
import { MAX_TEXT_LENGTH, QUESTIONS, deviceCategoryFor, type FeedbackSubmission, type RatingKey } from "@/feedback/survey";
import { guestToken } from "@/feedback/survey-memory";
import { formatTimestampDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { api } from "@/services/api-client";

interface FeedbackSurveyProps {
  signedIn: boolean;
  /** Set when this browser or account already answered: a new submission replaces the old answers. */
  previouslySubmittedAt: string | null;
  context: { gamesPlayed: string[]; completedRounds: number };
  onSubmitted: (submittedAt: string) => void;
  onClose: () => void;
}

type Ratings = Record<RatingKey, number | null>;
const UNRATED: Ratings = { gameplayFun: null, easeOfUnderstanding: null, playability: null, replayAppeal: null };

/** Employee Experience Survey: four 1–10 ratings and two optional comments. Always optional. */
export function FeedbackSurvey({ signedIn, previouslySubmittedAt, context, onSubmitted, onClose }: FeedbackSurveyProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  // One request id per opened survey: retries after a failure can never create a second response.
  const [requestId] = useState(() => crypto.randomUUID());
  const [ratings, setRatings] = useState<Ratings>(UNRATED);
  const [enjoyed, setEnjoyed] = useState("");
  const [improve, setImprove] = useState("");
  const [state, setState] = useState<{ kind: "editing" | "sending" | "done" } | { kind: "failed"; message: string }>({ kind: "editing" });
  const complete = QUESTIONS.every((q) => ratings[q.key] !== null);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  async function submit() {
    if (!complete || state.kind === "sending") return;
    setState({ kind: "sending" });
    const submission: FeedbackSubmission = {
      requestId,
      ratings: ratings as Record<RatingKey, number>,
      enjoyed: enjoyed.trim() || null,
      improve: improve.trim() || null,
      context: {
        ...context,
        deviceCategory: deviceCategoryFor(window.innerWidth, window.matchMedia("(pointer: coarse)").matches),
      },
      ...(signedIn ? {} : { guestToken: guestToken() }),
    };
    try {
      const receipt = await api.submitFeedback(submission);
      setState({ kind: "done" });
      onSubmitted(receipt.submittedAt);
    } catch (error) {
      // Never claim success: keep the answers and offer a retry.
      setState({ kind: "failed", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  }

  function trapTab(event: React.KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const done = state.kind === "done";

  return (
    <div className="absolute inset-0 z-[960] grid place-items-center bg-desk-950/60 p-3 backdrop-blur-[2px] sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-subtitle`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          trapTab(event);
        }}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-strong bg-desk-900 shadow-popover motion-safe:animate-pop-in"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
              Employee Experience Survey
            </h2>
            <p id={`${id}-subtitle`} className="mt-0.5 text-xs text-fg-muted">
              Your opinion has been requested by management. Voluntarily, of course.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close survey"
            className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
          >
            <CloseIcon className="size-4" />
          </button>
        </header>

        {done ? (
          <div role="status" className="px-6 py-10 text-center">
            <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success">
              <CheckIcon className="size-6" />
            </span>
            <p className="mt-4 text-sm font-semibold">Feedback received. Filed in triplicate.</p>
            <p className="mt-1 text-xs text-fg-muted">Thank you. A real person will read it, which is more than we can say for most surveys.</p>
            <button type="button" onClick={onClose} className="mt-5 rounded-lg bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-accent">
              Back to work
            </button>
          </div>
        ) : (
          <>
            <form
              id={`${id}-form`}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {previouslySubmittedAt && (
                <p className="rounded-lg border border-line bg-white/3 px-3 py-2 text-xs text-fg-muted">
                  You already answered on {formatTimestampDate(previouslySubmittedAt)}. Submitting again replaces your earlier answers.
                </p>
              )}
              <p className="text-xs text-fg-subtle">1 = not at all · 10 = absolutely. About a minute. No XP, no consequences.</p>
              {QUESTIONS.map((q, i) => (
                <RatingSlider
                  key={q.key}
                  inputRef={i === 0 ? firstRef : undefined}
                  id={`${id}-${q.key}`}
                  label={q.label}
                  description={q.description}
                  value={ratings[q.key]}
                  onChange={(value) => setRatings((current) => ({ ...current, [q.key]: value }))}
                />
              ))}
              <Comment id={`${id}-enjoyed`} label="What did you enjoy most?" value={enjoyed} onChange={setEnjoyed} />
              <Comment id={`${id}-improve`} label="What should we improve?" value={improve} onChange={setImprove} />
              <p className="text-[11px] text-fg-subtle">
                We store your answers, the games you played, your round count, guest or account, and a broad device type. No email, location or browser
                fingerprint.
              </p>
            </form>
            <footer className="border-t border-line bg-white/2 px-4 py-3">
              {state.kind === "failed" && (
                <p role="alert" className="mb-2 text-xs text-warning">
                  Not saved: {state.message} Your answers are still here.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg">
                  Not now
                </button>
                <span className="ml-auto text-[11px] text-fg-subtle max-sm:sr-only" aria-live="polite">
                  {!complete && "Rate all four to submit"}
                </span>
                <button
                  type="submit"
                  form={`${id}-form`}
                  disabled={!complete || state.kind === "sending"}
                  className="rounded-lg bg-accent-strong max-sm:ml-auto px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {state.kind === "sending" ? "Submitting…" : state.kind === "failed" ? "Try again" : "Submit feedback"}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

interface RatingSliderProps {
  id: string;
  label: string;
  description: string;
  value: number | null;
  onChange: (value: number) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** 1–10 slider that starts unrated (no biased default); any interaction sets a value. */
function RatingSlider({ id, label, description, value, onChange, inputRef }: RatingSliderProps) {
  const rated = value !== null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <output htmlFor={id} className={cn("text-sm font-semibold tabular-nums", rated ? "text-fg" : "text-fg-subtle")}>
          {rated ? value : "–"}
          <span className="text-xs font-normal text-fg-subtle"> / 10</span>
        </output>
      </div>
      <p id={`${id}-description`} className="text-xs text-fg-subtle">
        {description}
      </p>
      <input
        ref={inputRef}
        id={id}
        type="range"
        min={1}
        max={10}
        step={1}
        value={value ?? 5}
        aria-describedby={`${id}-description`}
        aria-valuetext={rated ? `${value} out of 10` : "Not rated yet"}
        onChange={(event) => onChange(Number(event.target.value))}
        // Clicking the thumb where it already sits (5) produces no change event.
        onPointerUp={(event) => onChange(Number(event.currentTarget.value))}
        className={cn("mt-1.5 h-5 w-full cursor-pointer", rated ? "accent-indigo-400" : "accent-slate-500 opacity-60")}
      />
      <div aria-hidden="true" className="flex justify-between px-0.5 text-[10px] text-fg-subtle tabular-nums">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cn("w-3 text-center", value === i + 1 && "font-semibold text-fg")}>
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function Comment({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label} <span className="font-normal text-fg-subtle">(optional)</span>
        </label>
        <span className="text-[10px] text-fg-subtle tabular-nums">
          {value.length}/{MAX_TEXT_LENGTH}
        </span>
      </div>
      <textarea
        id={id}
        rows={2}
        maxLength={MAX_TEXT_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-lg bg-white/5 px-3 py-2 text-[13px] ring-1 ring-line ring-inset placeholder:text-fg-subtle focus:ring-accent/60 focus:outline-none"
      />
    </div>
  );
}
