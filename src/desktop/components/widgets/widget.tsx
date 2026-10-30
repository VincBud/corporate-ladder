import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface WidgetProps {
  id: string;
  label: string;
  title: string;
  children: ReactNode;
  className?: string;
}

/** Compact desktop widget shell: small caps source label, title, content. */
export function Widget({ id, label, title, children, className }: WidgetProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-xl border border-line bg-desk-900/75 p-3.5 backdrop-blur-xl", className)}
    >
      <p className="text-[10px] font-medium tracking-wider text-fg-subtle uppercase">{label}</p>
      <h2 id={id} className="mt-0.5 text-[13px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
