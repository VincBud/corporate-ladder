"use client";

import { useCallback, useEffect, useState } from "react";
import { enqueueAchievementToasts } from "@/achievements/toast-queue";
import { useAuth } from "@/auth/use-auth";
import { CalendarIcon, ClockIcon, FunnelIcon, GridIcon, LockIcon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { DAILY_ASSIGNMENTS, getDailyAssignment, type DailyAssignmentId } from "@/daily/assignments";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { GUEST_SCOPE } from "@/performance/career-scope";
import { getCareerStore, useActiveCareerScope } from "@/performance/use-career";
import { ApiError, api } from "@/services/api-client";
import { notifyCompanyChanged } from "@/services/company-source";
import type { DailyAttemptState, DailyChallengeView, DailyOfficialResult, DailyOverview } from "@/types/daily";
import type { AppProps } from "../types";
import { DailyRound, clearDraft, toDailyPlay, type DailyPlay, type DailySubmitted } from "./daily-round";

const PLAYING_WARNING =
  "Your ranked Daily Challenge keeps running if you close this window. Reopen Daily Assignments to resume before its timer ends, or to see the official result.";

const primaryButton =
  "rounded-lg bg-accent-strong px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-50";
const quietButton =
  "rounded-lg bg-white/6 px-3 py-1.5 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10 disabled:opacity-50";

const STATE_LABEL: Record<DailyAttemptState, { label: string; tone: BadgeTone }> = {
  available: { label: "Available", tone: "accent" },
  inProgress: { label: "In progress", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  timedOut: { label: "Timed out", tone: "neutral" },
  missed: { label: "Missed", tone: "neutral" },
};

const GAME_ICON = { "reconciliation-rush": GridIcon, "pipeline-panic": FunnelIcon } as const;

type View =
  | { kind: "overview" }
  | { kind: "confirm"; assignmentId: DailyAssignmentId }
  | { kind: "playing"; play: DailyPlay }
  | { kind: "result"; assignmentId: DailyAssignmentId; response: DailySubmitted };

type Load = { status: "loading" } | { status: "ready"; data: DailyOverview; offsetMs: number } | { status: "error"; message: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** "Sun, Nov 1, 2026" for a UTC calendar date. */
function formatUtcDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function DailyApp({ openApp, setCloseWarning, setInFlow }: AppProps) {
  const auth = useAuth();
  const scope = useActiveCareerScope();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "overview" });
  const [pending, setPending] = useState<DailyAssignmentId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = auth.status === "signedIn";

  const refresh = useCallback(async () => {
    try {
      const data = await api.daily();
      setLoad({ status: "ready", data, offsetMs: Date.parse(data.serverNow) - Date.now() });
    } catch (e) {
      setLoad((current) => (current.status === "ready" ? current : { status: "error", message: messageOf(e) }));
    }
  }, []);

  // Reload whenever the account changes (sign in/out) and on first open.
  const authKey = auth.status === "signedIn" ? (auth.user?.id ?? auth.status) : auth.status;
  useEffect(() => {
    void refresh();
  }, [refresh, authKey]);

  const playing = view.kind === "playing";
  useEffect(() => {
    setCloseWarning(playing ? PLAYING_WARNING : null);
    return () => setCloseWarning(null);
  }, [playing, setCloseWarning]);

  // Game flow in progress: the desktop holds back prompts such as the survey.
  const inFlow = view.kind === "playing" || view.kind === "result";
  useEffect(() => {
    setInFlow(inFlow);
    return () => setInFlow(false);
  }, [inFlow, setInFlow]);

  async function start(assignmentId: DailyAssignmentId) {
    setPending(assignmentId);
    setError(null);
    try {
      const response = await api.startDaily(assignmentId);
      setView({ kind: "playing", play: toDailyPlay(response, performance.now()) });
    } catch (e) {
      setError(e instanceof ApiError && e.code === "daily_attempt_used" ? e.message : messageOf(e));
      setView({ kind: "overview" });
      void refresh();
    } finally {
      setPending(null);
    }
  }

  const onSubmitted = useCallback(
    (response: DailySubmitted) => {
      clearDraft(response.record.id);
      if (scope && scope !== GUEST_SCOPE) {
        getCareerStore(scope).applyVerifiedResult(response.record.id, response);
        if (response.achievements?.length) {
          enqueueAchievementToasts(response.achievements);
          void getCareerStore(scope).load();
        }
      }
      if (response.contribution.recorded) notifyCompanyChanged();
      const assignmentId = DAILY_ASSIGNMENTS.find((a) => a.gameId === response.record.gameId)!.id;
      setView({ kind: "result", assignmentId, response });
      void refresh();
    },
    [scope, refresh],
  );

  const backToOverview = useCallback(() => {
    setView({ kind: "overview" });
    void refresh();
  }, [refresh]);

  if (view.kind === "playing") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-violet-400/30 bg-violet-500/12 px-4 py-1.5 text-xs">
          <Badge tone="gold">Official attempt</Badge>
          <span className="font-medium text-fg">{getDailyAssignment(view.play.assignmentId as DailyAssignmentId).title}</span>
          <span className="text-fg-muted">One ranked attempt · the server keeps the clock · answers stay sealed until tomorrow</span>
        </div>
        <div className="relative min-h-0 flex-1">
          <DailyRound play={view.play} onSubmitted={onSubmitted} onLeave={backToOverview} />
        </div>
      </div>
    );
  }

  const data = load.status === "ready" ? load.data : null;
  const todayView = (id: DailyAssignmentId) => data?.today.find((c) => c.assignmentId === id) ?? null;

  if (view.kind === "result") {
    const challenge = todayView(view.assignmentId) ?? data?.history.find((c) => c.attempt?.sessionId === view.response.record.id) ?? null;
    return (
      <ResultScreen
        assignmentId={view.assignmentId}
        response={view.response}
        standing={challenge?.attempt?.sessionId === view.response.record.id ? challenge.attempt.standing : null}
        onBack={backToOverview}
        onPractice={() => openApp(getDailyAssignment(view.assignmentId).practiceApp)}
      />
    );
  }

  return (
    <div className="space-y-4 p-4 @xl:p-6">
      <section className="relative overflow-hidden rounded-xl border border-line bg-linear-to-br from-surface-raised to-surface p-5">
        <CalendarIcon className="pointer-events-none absolute -top-6 -right-6 size-40 text-violet-400/10" />
        <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">Daily Assignments · same puzzle for every employee</p>
        <h3 className="mt-1 text-2xl font-semibold tracking-tight">{data ? formatUtcDate(data.date) : "Today"}</h3>
        <p className="mt-1 text-sm text-fg-muted">
          Two shared challenges per UTC day. One ranked attempt each, optional, no streaks. Practice stays unlimited.
        </p>
        {load.status === "ready" && <ResetCountdown nextResetAt={load.data.nextResetAt} offsetMs={load.offsetMs} onReset={refresh} />}
      </section>

      {!signedIn && auth.status !== "loading" && (
        <Notice title="Preview mode">
          Ranked Daily Challenges need a cloud account, so every result is verified by the server.{" "}
          <button type="button" onClick={() => openApp("profile")} className="font-medium text-accent hover:underline">
            Sign in
          </button>{" "}
          to take today&apos;s attempts, or practice the games as a guest.
        </Notice>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[13px] text-warning">
          {error}
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[13px]">
          <span className="text-warning">Today&apos;s challenges couldn&apos;t be loaded. {load.message}</span>
          <button type="button" onClick={() => void refresh()} className={quietButton}>
            Try again
          </button>
        </div>
      )}

      <div className="grid gap-4 @3xl:grid-cols-2">
        {DAILY_ASSIGNMENTS.map((assignment) => (
          <ChallengeCard
            key={assignment.id}
            assignmentId={assignment.id}
            challenge={todayView(assignment.id)}
            loading={load.status === "loading"}
            signedIn={signedIn && data?.signedIn === true}
            confirming={view.kind === "confirm" && view.assignmentId === assignment.id}
            pending={pending === assignment.id}
            onAskStart={() => setView({ kind: "confirm", assignmentId: assignment.id })}
            onCancel={() => setView({ kind: "overview" })}
            onStart={() => void start(assignment.id)}
            onPractice={() => openApp(assignment.practiceApp)}
            onSignIn={() => openApp("profile")}
          />
        ))}
      </div>

      {data && data.signedIn && <History history={data.history} />}

      <Panel title="How Daily Challenges work">
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-fg-muted marker:text-fg-subtle">
          <li>Everyone gets the same puzzle per game and UTC day. A new pair opens at 00:00 UTC.</li>
          <li>Starting reserves your one ranked attempt. Leaving, reloading or losing the connection doesn&apos;t pause the server clock; reopen to resume until the deadline.</li>
          <li>A round started before midnight still finishes within its 90 seconds and counts for the day it started.</li>
          <li>Ranked rounds earn the usual Corporate XP, department progress and company contribution, once. There&apos;s no daily multiplier.</li>
          <li>Ranking: higher score, then less time, then no assistance, then earlier finish. Answers stay sealed so nobody can pass them on through the product.</li>
        </ul>
      </Panel>
    </div>
  );
}

function ResetCountdown({ nextResetAt, offsetMs, onReset }: { nextResetAt: string; offsetMs: number; onReset: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = Date.parse(nextResetAt) - (now + offsetMs);
  const reset = remaining <= 0;
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A new UTC day: fetch the new challenges.
  useEffect(() => {
    if (reset) onReset();
  }, [reset, onReset]);
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-xs text-fg-muted ring-1 ring-line ring-inset">
      <ClockIcon className="size-3.5" />
      New challenges in <span className="font-medium text-fg tabular-nums">{formatCountdown(remaining)}</span>
      <span className="text-fg-subtle">(00:00 UTC)</span>
    </p>
  );
}

interface ChallengeCardProps {
  assignmentId: DailyAssignmentId;
  challenge: DailyChallengeView | null;
  loading: boolean;
  signedIn: boolean;
  confirming: boolean;
  pending: boolean;
  onAskStart: () => void;
  onCancel: () => void;
  onStart: () => void;
  onPractice: () => void;
  onSignIn: () => void;
}

function ChallengeCard({ assignmentId, challenge, loading, signedIn, confirming, pending, onAskStart, onCancel, onStart, onPractice, onSignIn }: ChallengeCardProps) {
  const assignment = getDailyAssignment(assignmentId);
  const Icon = GAME_ICON[assignment.gameId];
  const state = challenge?.state ?? null;
  const result = challenge?.attempt?.result ?? null;
  const titleId = `daily-${assignmentId}-title`;

  return (
    <section aria-labelledby={titleId} className="flex flex-col rounded-xl border border-line bg-surface-raised/60 p-4">
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="text-sm font-semibold">
              {assignment.title}
            </h3>
            {state && <Badge tone={STATE_LABEL[state].tone}>{STATE_LABEL[state].label}</Badge>}
            {!signedIn && !loading && <Badge>Preview</Badge>}
          </div>
          <p className="text-xs text-fg-subtle">{assignment.gameName} · ranked · 90 seconds</p>
        </div>
      </header>
      <p className="mt-3 text-[13px] text-fg-muted">{assignment.description}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle">
        <LockIcon className="size-3.5 shrink-0" />
        One ranked attempt per UTC day. Starting uses it, even if you leave or time runs out.
      </p>

      {result && <OfficialResult result={result} standing={challenge?.attempt?.standing ?? null} className="mt-3" />}
      {state === "timedOut" && !result && <p className="mt-3 text-xs text-fg-muted">Time ran out. The official result is being recorded.</p>}

      <div className="mt-4 flex flex-1 flex-wrap items-end gap-2">
        {loading ? (
          <button type="button" disabled className={quietButton}>
            Loading…
          </button>
        ) : !signedIn ? (
          <button type="button" onClick={onSignIn} className={primaryButton}>
            Sign in for the ranked attempt
          </button>
        ) : state === "available" && confirming ? (
          <div role="group" aria-label={`Start ${assignment.title}`} className="w-full rounded-lg border border-violet-400/30 bg-violet-500/8 p-3">
            <p className="text-[13px] font-medium">Start your ranked attempt?</p>
            <p className="mt-0.5 text-xs text-fg-muted">The 90-second clock starts immediately and keeps running if you leave. This is today&apos;s only ranked attempt.</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" onClick={onCancel} className={quietButton} autoFocus>
                Not yet
              </button>
              <button type="button" onClick={onStart} disabled={pending} className={primaryButton}>
                {pending ? "Starting…" : "Start the clock"}
              </button>
            </div>
          </div>
        ) : state === "available" ? (
          <button type="button" onClick={onAskStart} className={primaryButton}>
            Start ranked attempt
          </button>
        ) : state === "inProgress" ? (
          <button type="button" onClick={onStart} disabled={pending} className={primaryButton}>
            {pending ? "Resuming…" : "Resume attempt"}
          </button>
        ) : null}
        {!confirming && (
          <button type="button" onClick={onPractice} className={quietButton}>
            Practice {assignment.gameName}
          </button>
        )}
      </div>
      {!confirming && <p className="mt-2 text-[11px] text-fg-subtle">Practice rounds are unlimited, use different puzzles and never affect the daily ranking.</p>}
    </section>
  );
}

function OfficialResult({ result, standing, className }: { result: DailyOfficialResult; standing: { rank: number; participants: number } | null; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-line bg-white/3 p-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">Official result</p>
        {standing && (
          <p className="text-xs text-fg-muted">
            Standing <span className="font-semibold text-fg tabular-nums">#{standing.rank}</span> of {formatNumber(standing.participants)} so far
          </p>
        )}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {formatNumber(result.score)} <span className="text-sm font-normal text-fg-subtle">/ {formatNumber(result.maxScore)}</span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs @md:grid-cols-4">
        <Stat label="Correct" value={`${result.correct} / ${result.total}`} />
        <Stat label="Mistakes" value={String(result.mistakes)} />
        <Stat label="Time used" value={result.completion === "timedOut" ? "Timed out" : formatDuration(result.timeUsedMs)} />
        <Stat label="Assistance" value={result.assistanceUsed ? "Used" : "None"} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 @md:block">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function History({ history }: { history: DailyChallengeView[] }) {
  const dates = [...new Set(history.map((c) => c.date))];
  if (dates.length === 0) return null;
  return (
    <Panel title="Recent days" description="For your records only. Missing a day has no penalty.">
      <ul className="divide-y divide-line">
        {dates.map((date) => (
          <li key={date} className="flex flex-col gap-1.5 py-2 text-xs @xl:flex-row @xl:items-center @xl:justify-between">
            <span className="text-fg-muted">{formatUtcDate(date)}</span>
            <span className="flex flex-wrap gap-1.5">
              {history
                .filter((c) => c.date === date)
                .map((c) => {
                  const state = c.state ?? "missed";
                  const result = c.attempt?.result;
                  return (
                    <Badge key={c.challengeId} tone={STATE_LABEL[state].tone}>
                      {getDailyAssignment(c.assignmentId).title}: {result ? `${formatNumber(result.score)} pts` : STATE_LABEL[state].label}
                    </Badge>
                  );
                })}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

interface ResultScreenProps {
  assignmentId: DailyAssignmentId;
  response: DailySubmitted;
  standing: { rank: number; participants: number } | null;
  onBack: () => void;
  onPractice: () => void;
}

function ResultScreen({ assignmentId, response, standing, onBack, onPractice }: ResultScreenProps) {
  const assignment = getDailyAssignment(assignmentId);
  const record = response.record;
  const result: DailyOfficialResult = {
    score: record.score,
    maxScore: record.maxScore,
    completion: record.completion,
    timeUsedMs: record.timeUsedMs,
    timeRemainingMs: record.timeRemainingMs,
    assistanceUsed: record.assistanceUsed,
    completedAt: record.completedAt,
    xpAwarded: record.xpAwarded,
    correct: record.errorsFixed,
    total: record.totalErrors,
    mistakes: record.incorrectCorrections,
  };
  return (
    <div className="space-y-4 p-4 @xl:p-6">
      <section className="rounded-xl border border-line bg-linear-to-br from-surface-raised to-surface p-5">
        <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">{assignment.title} · official result recorded</p>
        <h3 className="mt-1 text-2xl font-semibold tracking-tight">{record.completion === "submitted" ? "Submitted for the record" : "Time ran out"}</h3>
        <p className="mt-1 text-sm text-fg-muted">Verified by the server. This was today&apos;s ranked attempt for {assignment.gameName}.</p>
      </section>
      <div role="status" aria-label="Official daily result">
        <OfficialResult result={result} standing={standing} />
      </div>
      <Panel title="Rewards">
        <p className="text-[13px] text-fg-muted">
          <span className="font-medium text-gold">+{formatNumber(record.xpAwarded)} Corporate XP</span> under the usual rules, plus department progress and
          company contribution where they apply.
        </p>
      </Panel>
      <Notice title="Answers stay sealed">
        Everyone plays the same puzzle today, so the decision review isn&apos;t shown for ranked attempts. Practice rounds still come with the full review.
      </Notice>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onBack} className={primaryButton}>
          Back to Daily Assignments
        </button>
        <button type="button" onClick={onPractice} className={quietButton}>
          Practice {assignment.gameName}
        </button>
      </div>
    </div>
  );
}
