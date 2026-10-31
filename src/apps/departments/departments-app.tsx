"use client";

import { useState, type ReactNode } from "react";
import { BriefcaseIcon, ChevronLeftIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { DEPARTMENT_TRACKS, plannedGames, progressionGames } from "@/career/department-tracks";
import { useAuth } from "@/auth/use-auth";
import { BRAND } from "@/config/brand";
import { CANONICAL_DEPARTMENTS, getCanonicalDepartment, type CanonicalDepartmentId } from "@/config/departments";
import { cn } from "@/lib/cn";
import { formatNumber, formatTimestampDate } from "@/lib/format";
import { createRequestId } from "@/lib/session-id";
import { departmentRoleFor } from "@/performance/player";
import { getCareerStore, useActiveCareerScope, useCareer } from "@/performance/use-career";
import { api } from "@/services/api-client";
import { notifyCompanyChanged } from "@/services/company-source";
import type { CareerState } from "@/performance/career-store";
import type { AppProps } from "../types";
import { useLiveCompany } from "../company/use-live-company";
import { CareerTrack } from "./career-track";

type View =
  | { kind: "directory" }
  | { kind: "detail"; id: CanonicalDepartmentId }
  | { kind: "confirm"; id: CanonicalDepartmentId; requestId: string }
  | { kind: "done"; id: CanonicalDepartmentId; transferred: boolean };

const primaryButton =
  "rounded-lg bg-accent-strong px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-50";
const quietButton =
  "rounded-lg bg-white/6 px-3 py-1.5 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10 disabled:opacity-50";

type Membership = "guest" | "unavailable" | "loading" | "none" | "member";

function membershipState(authStatus: string, career: CareerState): Membership {
  if (authStatus === "disabled") return "unavailable";
  if (authStatus !== "signedIn") return authStatus === "loading" ? "loading" : "guest";
  if (career.source !== "cloud" || !career.departmentCareer) return "loading";
  return career.departmentCareer.current ? "member" : "none";
}

/** Where a player would start in a department: their earned position if they worked there before, otherwise entry. */
function startingIndex(career: CareerState, id: CanonicalDepartmentId): number {
  return career.departmentCareer?.progress.find((p) => p.departmentId === id)?.positionIndex ?? 0;
}

export function DepartmentsApp({ openApp }: AppProps) {
  const auth = useAuth();
  const career = useCareer();
  const scope = useActiveCareerScope();
  const company = useLiveCompany();
  const [view, setView] = useState<View>({ kind: "directory" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = membershipState(auth.status, career);
  const summary = career.departmentCareer;
  const role = departmentRoleFor(career);
  const memberCounts = company.state.status === "ok" ? company.state.snapshot.employees.membership : null;
  const minGroup = company.state.status === "ok" ? company.state.snapshot.employees.minGroupSize : 5;

  const open = (next: View) => {
    setError(null);
    setView(next);
  };

  async function confirm(id: CanonicalDepartmentId, requestId: string) {
    setPending(true);
    setError(null);
    try {
      const result = await api.selectDepartment(id, requestId);
      if (scope) await getCareerStore(scope).load();
      notifyCompanyChanged();
      setView({ kind: "done", id, transferred: result.status === "transferred" || (result.status === "duplicate" && result.membership.startReason === "transfer") });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the department.");
    } finally {
      setPending(false);
    }
  }

  function action(id: CanonicalDepartmentId) {
    const name = getCanonicalDepartment(id).name;
    switch (state) {
      case "unavailable":
        return <p className="text-xs text-fg-subtle">Accounts aren&apos;t configured on this server, so departments can only be previewed.</p>;
      case "guest":
        return (
          <button type="button" onClick={() => openApp("profile")} className={quietButton}>
            Sign in to join
          </button>
        );
      case "loading":
        return (
          <button type="button" disabled className={quietButton}>
            Loading your record…
          </button>
        );
      case "none":
        return (
          <button type="button" onClick={() => open({ kind: "confirm", id, requestId: createRequestId() })} className={primaryButton}>
            Join {name}
          </button>
        );
      case "member":
        if (summary!.current!.departmentId === id) return <Badge tone="success">Your department</Badge>;
        return summary!.canTransferNow ? (
          <button type="button" onClick={() => open({ kind: "confirm", id, requestId: createRequestId() })} className={primaryButton}>
            Transfer to {name}
          </button>
        ) : (
          <button type="button" disabled className={quietButton}>
            Transfers open {formatTimestampDate(summary!.nextTransferAt!)}
          </button>
        );
    }
  }

  const memberCount = (id: string) => {
    const cell = memberCounts?.find((g) => g.id === id);
    if (!cell) return null;
    return cell.count === null ? `Fewer than ${minGroup} employees` : `${formatNumber(cell.count)} employees`;
  };

  return (
    <div className="space-y-4 p-4 @xl:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-rose-400 to-fuchsia-700 text-white ring-1 ring-white/20 ring-inset">
            <BriefcaseIcon className="size-5.5" />
          </span>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Departments</h3>
            <p className="text-xs text-fg-muted">{BRAND.company} · Human Resources self-service</p>
          </div>
        </div>
        {role && (
          <p className="text-right text-xs text-fg-muted">
            <span className="block text-[13px] font-medium text-fg">
              {role.title}, {role.name}
            </span>
            {summary!.canTransferNow ? "Transfer available" : `Next transfer ${formatTimestampDate(summary!.nextTransferAt!)}`}
          </p>
        )}
      </header>

      {view.kind === "directory" && (
        <>
          {state === "none" && (
            <Notice title={`Welcome to ${BRAND.company}`}>
              Pick the department you want to build a career in. Your department sets your job title and career track. It
              doesn&apos;t limit which games you can play, and company contribution always follows the work you do, not
              your department. No rush: you can keep playing and decide later.
            </Notice>
          )}
          {state === "guest" && (
            <Notice title="Preview mode">
              Browse every department and its career track. Joining one needs a cloud account: sign in from Employee
              Profile.
            </Notice>
          )}
          {(["operating", "support"] as const).map((kind) => (
            <section key={kind} aria-labelledby={`dept-${kind}`} className="space-y-2">
              <h4 id={`dept-${kind}`} className="text-sm font-semibold">
                {kind === "operating" ? "Operating departments" : "Support departments"}
              </h4>
              <ul className="grid gap-2.5 @xl:grid-cols-2 @4xl:grid-cols-3">
                {CANONICAL_DEPARTMENTS.filter((d) => d.kind === kind).map((d) => {
                  const mine = summary?.current?.departmentId === d.id;
                  const count = memberCount(d.id);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => open({ kind: "detail", id: d.id })}
                        className={cn(
                          "flex h-full w-full flex-col gap-1 rounded-xl border bg-surface-raised/60 p-3.5 text-left transition-colors hover:bg-surface-hover",
                          mine ? "border-success/40" : "border-line",
                        )}
                      >
                        <span className="flex w-full items-start justify-between gap-2">
                          <span className="text-[13px] font-semibold">{d.name}</span>
                          {mine && <Badge tone="success">Your department</Badge>}
                        </span>
                        <span className="text-xs text-fg-muted">{d.description}</span>
                        <span className="mt-auto pt-1 text-[11px] text-fg-subtle">
                          Starts as {DEPARTMENT_TRACKS[d.id][0].title} · ends as {DEPARTMENT_TRACKS[d.id].at(-1)!.title}
                          {count && <span className="block">{count}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {view.kind === "detail" && (
        <DepartmentDetail
          id={view.id}
          career={career}
          memberCount={memberCount(view.id)}
          action={action(view.id)}
          onBack={() => open({ kind: "directory" })}
        />
      )}

      {view.kind === "confirm" && (
        <Confirm
          id={view.id}
          career={career}
          pending={pending}
          error={error}
          onConfirm={() => void confirm(view.id, view.requestId)}
          onCancel={() => open({ kind: "detail", id: view.id })}
        />
      )}

      {view.kind === "done" && (
        <section aria-labelledby="dept-done" className="space-y-3 rounded-xl border border-success/30 bg-success/8 p-5">
          <p className="text-[11px] font-medium tracking-wider text-success uppercase">{view.transferred ? "Transfer complete" : "Welcome aboard"}</p>
          <h4 id="dept-done" className="text-lg font-semibold">
            {role ? `${role.title}, ${role.name}` : getCanonicalDepartment(view.id).name}
          </h4>
          <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] text-fg-muted">
            “{getCanonicalDepartment(view.id).introduction}”
            <footer className="mt-1 text-[11px] text-fg-subtle">Your new department head (in a meeting)</footer>
          </blockquote>
          <p className="text-xs text-fg-muted">
            Your Corporate XP and verified history come with you.{" "}
            {summary?.nextTransferAt && <>Your next transfer is possible from {formatTimestampDate(summary.nextTransferAt)}.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openApp("career")} className={primaryButton}>
              View your career
            </button>
            <button type="button" onClick={() => openApp("profile")} className={quietButton}>
              Employee profile
            </button>
            <button type="button" onClick={() => open({ kind: "directory" })} className={quietButton}>
              Back to departments
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function DepartmentDetail({
  id,
  career,
  memberCount,
  action,
  onBack,
}: {
  id: CanonicalDepartmentId;
  career: CareerState;
  memberCount: string | null;
  action: ReactNode;
  onBack: () => void;
}) {
  const department = getCanonicalDepartment(id);
  const live = progressionGames(id);
  const planned = plannedGames(id, department.plannedGames);
  const mine = career.departmentCareer?.current?.departmentId === id;
  const worked = career.departmentCareer?.progress.find((p) => p.departmentId === id);

  return (
    <section aria-labelledby="dept-detail" className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
        <ChevronLeftIcon className="size-4" /> All departments
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-linear-to-br from-surface-raised to-surface p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-wider text-fg-subtle uppercase">{department.kind === "operating" ? "Operating department" : "Support department"}</p>
          <h4 id="dept-detail" className="text-xl font-semibold tracking-tight">
            {department.name}
          </h4>
          <p className="mt-1 text-sm text-fg-muted">{department.description}</p>
          <blockquote className="mt-3 border-l-2 border-gold/60 pl-3 text-[13px]">“{department.introduction}”</blockquote>
          {memberCount && <p className="mt-2 text-[11px] text-fg-subtle">{memberCount}</p>}
        </div>
        <div className="shrink-0">{action}</div>
      </div>

      <div className="grid gap-4 @2xl:grid-cols-[1fr_16rem]">
        <Panel
          title="Career track"
          description={mine ? "Your position is highlighted." : `Everyone starts as ${DEPARTMENT_TRACKS[id][0].title}.`}
        >
          <CareerTrack departmentId={id} currentIndex={mine || worked ? (worked?.positionIndex ?? 0) : null} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Responsibilities">
            <ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted">
              {department.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Games" description="Any employee can play any game.">
            <ul className="space-y-1.5 text-xs">
              {live.map((g) => (
                <li key={g.gameId} className="flex items-center justify-between gap-2">
                  {g.title} <Badge tone="success">Available</Badge>
                </li>
              ))}
              {planned.map((title) => (
                <li key={title} className="flex items-center justify-between gap-2 text-fg-muted">
                  {title} <Badge>Planned</Badge>
                </li>
              ))}
              {live.length + planned.length === 0 && <li className="text-fg-subtle">No games announced yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Confirm({
  id,
  career,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  id: CanonicalDepartmentId;
  career: CareerState;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const department = getCanonicalDepartment(id);
  const current = career.departmentCareer?.current;
  const transfer = Boolean(current);
  const from = current ? getCanonicalDepartment(current.departmentId as CanonicalDepartmentId).name : null;
  const title = DEPARTMENT_TRACKS[id][startingIndex(career, id)].title;

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="dept-confirm" className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft p-5">
      <h4 id="dept-confirm" className="text-lg font-semibold">
        {transfer ? `Transfer from ${from} to ${department.name}?` : `Join ${department.name}?`}
      </h4>
      <p className="text-[13px]">
        You&apos;ll start as <strong>{title}</strong>.
      </p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted">
        <li>Your Corporate XP, rank and verified round history stay exactly as they are.</li>
        {transfer && <li>Your record in {from} is kept. If you return later, you resume your position there.</li>}
        <li>After this, your next transfer is possible in {career.departmentCareer?.cooldownDays ?? 30} days.</li>
        <li>Company contribution isn&apos;t affected: it always follows the game you play.</li>
      </ul>
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} disabled={pending} className={primaryButton}>
          {pending ? "Filing the paperwork…" : transfer ? "Confirm transfer" : `Join ${department.name}`}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={quietButton}>
          Cancel
        </button>
      </div>
    </section>
  );
}
