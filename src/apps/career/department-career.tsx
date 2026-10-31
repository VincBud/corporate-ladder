"use client";

import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { DEPARTMENT_TRACKS } from "@/career/department-tracks";
import { departmentDisplayName, getCanonicalDepartment, isCanonicalDepartmentId } from "@/config/departments";
import { formatTimestampDate } from "@/lib/format";
import type { CareerState } from "@/performance/career-store";
import { departmentRoleFor } from "@/performance/player";
import { CareerTrack, requirementText } from "../departments/career-track";

const quietButton =
  "rounded-lg bg-white/6 px-3 py-1.5 text-xs font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10";

/** Department career: separate from Corporate XP and rank. */
export function DepartmentCareer({ career, onOpenDepartments }: { career: CareerState; onOpenDepartments: () => void }) {
  const summary = career.departmentCareer;
  const role = departmentRoleFor(career);

  if (career.source !== "cloud") {
    return (
      <Panel title="Department career" description="Job titles and career tracks for each department.">
        <p className="text-xs text-fg-muted">Department careers need a cloud account. You can preview every department and its track.</p>
        <button type="button" onClick={onOpenDepartments} className={`mt-3 ${quietButton}`}>
          Browse departments
        </button>
      </Panel>
    );
  }
  if (!summary) {
    return (
      <Panel title="Department career">
        <p className="text-xs text-fg-subtle">Loading your department record…</p>
      </Panel>
    );
  }
  if (!role) {
    return (
      <Panel title="Department career" description="Separate from your Corporate XP and rank.">
        <p className="text-[13px]">You haven&apos;t joined a department yet.</p>
        <p className="mt-1 text-xs text-fg-muted">Your department sets your job title and career track. You can keep playing any game without one.</p>
        <button type="button" onClick={onOpenDepartments} className={`mt-3 ${quietButton}`}>
          Choose a department
        </button>
      </Panel>
    );
  }

  const next = role.progress.next;
  const pastDepartments = summary.progress.filter((p) => p.departmentId !== role.departmentId);
  return (
    <Panel
      title="Department career"
      description="Separate from Corporate XP: your job title within your department."
      actions={
        <button type="button" onClick={onOpenDepartments} className={quietButton}>
          {summary.canTransferNow ? "Request transfer" : "Departments"}
        </button>
      }
    >
      <div className="grid gap-4 @2xl:grid-cols-[1fr_16rem]">
        <div>
          <p className="text-[11px] tracking-wider text-fg-subtle uppercase">{role.name}</p>
          <p className="text-lg font-semibold">{role.title}</p>
          <p className="mb-3 text-xs text-fg-muted">
            Since {formatTimestampDate(summary.current!.startedAt)} · {role.progress.qualifyingRounds} qualifying verified{" "}
            {role.progress.qualifyingRounds === 1 ? "round" : "rounds"} in this department
          </p>
          <CareerTrack departmentId={role.departmentId} currentIndex={role.progress.positionIndex} />
        </div>
        <div className="space-y-3 text-xs">
          <section aria-label="Next promotion" className="rounded-lg bg-white/4 p-3 ring-1 ring-line ring-inset">
            <h4 className="text-[11px] text-fg-subtle">Next promotion</h4>
            {next ? (
              <>
                <p className="mt-0.5 text-[13px] font-medium">{DEPARTMENT_TRACKS[role.departmentId][next.index].title}</p>
                <p className="mt-0.5 text-fg-muted">{requirementText(next.requirement)}</p>
                {next.remaining !== null && <p className="mt-1 text-gold">{next.remaining} more to go</p>}
              </>
            ) : (
              <p className="mt-0.5 text-fg-muted">Top of the track. Please update your LinkedIn.</p>
            )}
          </section>
          <section aria-label="Transfers" className="rounded-lg bg-white/4 p-3 ring-1 ring-line ring-inset">
            <h4 className="text-[11px] text-fg-subtle">Transfers</h4>
            <p className="mt-0.5">
              {summary.canTransferNow ? "You can transfer now." : `Next transfer possible ${formatTimestampDate(summary.nextTransferAt!)}.`}
            </p>
            <p className="mt-0.5 text-fg-subtle">{summary.cooldownDays}-day cooldown after each move. XP and history always stay.</p>
          </section>
          {summary.history.length > 0 && (
            <section aria-label="Membership history">
              <h4 className="mb-1 text-[11px] text-fg-subtle">Membership history</h4>
              <ol className="space-y-1">
                {summary.history.map((m) => {
                  const best = isCanonicalDepartmentId(m.departmentId)
                    ? summary.progress.find((p) => p.departmentId === m.departmentId)
                    : undefined;
                  return (
                    <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-1">
                      <span>
                        {departmentDisplayName(m.departmentId)}
                        {best && isCanonicalDepartmentId(m.departmentId) && (
                          <span className="text-fg-subtle"> · {DEPARTMENT_TRACKS[m.departmentId][best.positionIndex].title}</span>
                        )}
                      </span>
                      <span className="text-fg-subtle tabular-nums">
                        {formatTimestampDate(m.startedAt)} – {m.endedAt ? formatTimestampDate(m.endedAt) : <Badge tone="success">Current</Badge>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          {pastDepartments.length > 0 && (
            <p className="text-fg-subtle">
              Positions earned elsewhere are kept: returning to{" "}
              {pastDepartments.map((p) => getCanonicalDepartment(p.departmentId).name).join(", ")} resumes your career there.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
