import { cn } from "@/lib/cn";
import type { AppDefinition } from "./types";

const SIZES = {
  xs: { tile: "size-5 rounded-[5px]", glyph: "size-3" },
  sm: { tile: "size-8 rounded-lg", glyph: "size-4.5" },
  lg: { tile: "size-13 rounded-[14px]", glyph: "size-7" },
} as const;

export function AppIcon({ app, size = "sm", className }: { app: AppDefinition; size?: keyof typeof SIZES; className?: string }) {
  const Glyph = app.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center bg-linear-to-br text-white shadow-md ring-1 ring-white/20 ring-inset",
        app.tint,
        SIZES[size].tile,
        className,
      )}
    >
      <span className="absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/20 to-transparent" />
      <Glyph className={cn("relative", SIZES[size].glyph)} />
    </span>
  );
}
