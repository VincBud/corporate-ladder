import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PanelProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, description, actions, children, className }: PanelProps) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface-raised/60 p-4", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
