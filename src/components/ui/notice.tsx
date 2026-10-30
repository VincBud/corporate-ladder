import type { ReactNode } from "react";
import { InfoIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

interface NoticeProps {
  title: string;
  children: ReactNode;
  tone?: "info" | "warning";
  className?: string;
}

/** Callout for disclosures such as "mock data" or "not implemented yet". */
export function Notice({ title, children, tone = "info", className }: NoticeProps) {
  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed",
        tone === "warning" ? "border-warning/30 bg-warning/8" : "border-accent/25 bg-accent-soft",
        className,
      )}
    >
      <InfoIcon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-accent")} />
      <div>
        <p className="font-medium text-fg">{title}</p>
        <div className="text-fg-muted">{children}</div>
      </div>
    </div>
  );
}
