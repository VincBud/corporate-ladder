import { CheckIcon, LockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { DEPARTMENT_TRACKS, requirementFor, type PositionRequirement } from "@/career/department-tracks";
import { getCanonicalDepartment, type CanonicalDepartmentId } from "@/config/departments";
import { cn } from "@/lib/cn";

export function requirementText(requirement: PositionRequirement): string {
  switch (requirement.kind) {
    case "entry":
      return "On joining";
    case "verifiedRounds":
      return `${requirement.rounds} qualifying verified rounds of ${requirement.games.join(" or ")} while in the department`;
    case "departmentGameplay":
      return requirement.plannedGames.length
        ? `Department gameplay (planned: ${requirement.plannedGames.join(", ")})`
        : "Department gameplay (planned)";
    case "performanceReview":
      return "Quarterly Performance Review (planned)";
  }
}

/** A department's career track; highlights the current position when given. */
export function CareerTrack({ departmentId, currentIndex = null }: { departmentId: CanonicalDepartmentId; currentIndex?: number | null }) {
  const track = DEPARTMENT_TRACKS[departmentId];
  const planned = getCanonicalDepartment(departmentId).plannedGames;
  return (
    <ol aria-label={`${getCanonicalDepartment(departmentId).name} career track`} className="space-y-1">
      {track.map((position, index) => {
        const reached = currentIndex !== null && index <= currentIndex;
        const current = index === currentIndex;
        return (
          <li
            key={position.id}
            aria-current={current ? "step" : undefined}
            className={cn("flex items-start gap-2.5 rounded-lg px-2 py-1.5", current && "bg-gold-soft ring-1 ring-gold/30 ring-inset")}
          >
            <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center">
              {reached ? <CheckIcon className="size-4 text-gold" /> : currentIndex === null ? <span className="size-1.5 rounded-full bg-fg-subtle" /> : <LockIcon className="size-3.5 text-fg-subtle" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-[13px]", reached || currentIndex === null ? "text-fg" : "text-fg-muted")}>
                {position.title} {current && <Badge tone="gold">You are here</Badge>}
                {currentIndex !== null && !reached && <span className="sr-only"> (not reached)</span>}
              </p>
              <p className="text-[11px] text-fg-subtle">
                {position.summary} <span className="text-fg-muted">· {requirementText(requirementFor(departmentId, index, planned))}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
