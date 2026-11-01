import { CheckIcon, ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { onboardingMilestones } from "@/onboarding/checklist";
import type { AppId } from "@/types/app";
import { Widget } from "./widget";

interface OnboardingWidgetProps {
  visitedAppIds: ReadonlySet<AppId>;
  records: number;
  hasDepartment: boolean;
  onOpenApp: (appId: AppId) => void;
  /** Null while a round is running. */
  onOpenOrientation: (() => void) | null;
  className?: string;
}

/** Optional discovery milestones; each is ticked only by doing it. */
export function OnboardingWidget({ visitedAppIds, records, hasDepartment, onOpenApp, onOpenOrientation, className }: OnboardingWidgetProps) {
  const milestones = onboardingMilestones({ records, hasDepartment, visited: visitedAppIds });
  const completed = milestones.filter((m) => m.done).length;

  return (
    <Widget id="widget-onboarding" label="People & Culture" title="Onboarding checklist" className={className}>
      <p className="mt-0.5 text-xs text-fg-muted">
        {completed === milestones.length ? "Onboarding complete. You are now fully synergized." : "Your buddy is on PTO. Please self-onboard."}
      </p>
      <ul className="mt-2 -mx-1.5">
        {milestones.map((milestone) => (
          <li key={milestone.id}>
            <button
              type="button"
              onClick={() => onOpenApp(milestone.appId)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-white/6"
            >
              {milestone.done ? (
                <CheckIcon className="size-4 text-success" />
              ) : (
                <span aria-hidden="true" className="size-4 rounded-full border border-line-strong" />
              )}
              <span className={cn("flex-1", milestone.done && "text-fg-muted line-through decoration-fg-subtle")}>
                {milestone.label}
                <span className="sr-only">{milestone.done ? " (done)" : ""}</span>
              </span>
              <ChevronRightIcon className="size-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
      {onOpenOrientation && (
        <button type="button" onClick={onOpenOrientation} className="mt-1.5 text-xs font-medium text-accent hover:underline">
          Replay the orientation
        </button>
      )}
    </Widget>
  );
}
