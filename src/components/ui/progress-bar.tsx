import { cn } from "@/lib/cn";

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  tone?: "accent" | "gold";
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({ value, max, label, tone = "accent", size = "md", className }: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("overflow-hidden rounded-full bg-white/8", size === "sm" ? "h-1" : "h-2", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "gold" ? "bg-linear-to-r from-gold/60 to-gold" : "bg-linear-to-r from-accent-strong to-accent",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
