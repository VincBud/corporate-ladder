import { cn } from "@/lib/cn";

/** LadderOS mark: three ascending rungs. Original artwork; inherits text color. */
export function OsLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
      <rect x="3" y="15" width="5" height="6" rx="1.5" opacity="0.45" />
      <rect x="9.5" y="9.5" width="5" height="11.5" rx="1.5" opacity="0.72" />
      <rect x="16" y="3" width="5" height="18" rx="1.5" />
    </svg>
  );
}
