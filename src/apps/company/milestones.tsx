import { CheckIcon, LockIcon } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import type { MilestoneStatus } from "@/simulation/milestones";
import { periodLabel } from "@/simulation/periods";

export function Milestones({ milestones }: { milestones: readonly MilestoneStatus[] }) {
  const reached = milestones.filter((m) => m.reachedIn).length;
  return (
    <Panel title="Company milestones" description={`${reached} of ${milestones.length} reached`}>
      <ul className="space-y-2">
        {milestones.map((m) => (
          <li key={m.id} className="flex items-start gap-2">
            {m.reachedIn ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" /> : <LockIcon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />}
            <div className="min-w-0">
              <p className={cn("text-[13px]", !m.reachedIn && "text-fg-muted")}>
                {m.title}
                <span className="sr-only">{m.reachedIn ? " (reached)" : " (not reached)"}</span>
              </p>
              <p className="text-[11px] text-fg-subtle">
                {m.reachedIn ? `Reached ${periodLabel(m.reachedIn)}` : m.description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
