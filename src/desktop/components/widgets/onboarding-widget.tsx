import { CheckIcon, ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { AppId } from "@/types/app";
import { Widget } from "./widget";

const TASKS: ReadonlyArray<{ appId: AppId; label: string }> = [
  { appId: "profile", label: "Review your employee badge" },
  { appId: "career", label: "Study the career ladder" },
  { appId: "leaderboard", label: "Size up the competition" },
  { appId: "spreadsheet-wars", label: "Preview Spreadsheet Wars" },
];

interface OnboardingWidgetProps {
  visitedAppIds: ReadonlySet<AppId>;
  onOpenApp: (appId: AppId) => void;
  className?: string;
}

/** Guides first-time visitors through each app. */
export function OnboardingWidget({ visitedAppIds, onOpenApp, className }: OnboardingWidgetProps) {
  const completed = TASKS.filter((task) => visitedAppIds.has(task.appId)).length;

  return (
    <Widget id="widget-onboarding" label="People & Culture" title="Onboarding checklist" className={className}>
      <p className="mt-0.5 text-xs text-fg-muted">
        {completed === TASKS.length
          ? "Onboarding complete. You are now fully synergized."
          : "Your buddy is on PTO. Please self-onboard."}
      </p>
      <ul className="mt-2 -mx-1.5">
        <li className="flex items-center gap-2.5 px-1.5 py-1 text-[13px] text-fg-muted">
          <CheckIcon className="size-4 text-success" />
          <span className="line-through decoration-fg-subtle">Activate badge</span>
        </li>
        {TASKS.map((task) => {
          const done = visitedAppIds.has(task.appId);
          return (
            <li key={task.appId}>
              <button
                type="button"
                onClick={() => onOpenApp(task.appId)}
                className="group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-white/6"
              >
                {done ? (
                  <CheckIcon className="size-4 text-success" />
                ) : (
                  <span aria-hidden="true" className="size-4 rounded-full border border-line-strong" />
                )}
                <span className={cn("flex-1", done && "text-fg-muted line-through decoration-fg-subtle")}>
                  {task.label}
                  <span className="sr-only">{done ? " (done)" : ""}</span>
                </span>
                <ChevronRightIcon className="size-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
}
