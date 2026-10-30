import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-10 text-sm",
  lg: "size-16 text-xl",
} as const;

export function Avatar({ name, size = "md", className }: { name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-linear-to-br from-slate-500 to-slate-700 font-semibold text-white ring-1 ring-white/15",
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
