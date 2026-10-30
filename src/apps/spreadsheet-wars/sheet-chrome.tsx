import { cn } from "@/lib/cn";

const MENU_ITEMS = ["File", "Edit", "View", "Insert", "Format", "Data", "Tools", "Help"];

const TOOLBAR_GROUPS = [
  ["Undo", "Redo"],
  ["Bold", "Italic", "Underline"],
  ["Currency", "Percent", "AutoSum"],
] as const;

const TOOLBAR_GLYPHS: Record<(typeof TOOLBAR_GROUPS)[number][number], string> = {
  Undo: "↶",
  Redo: "↷",
  Bold: "B",
  Italic: "I",
  Underline: "U",
  Currency: "¤",
  Percent: "%",
  AutoSum: "Σ",
};

/** Decorative application menu row. */
export function SheetMenuBar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex gap-4 overflow-x-auto border-b border-slate-200 px-3 py-1.5 text-[12px] text-slate-600", className)}
    >
      {MENU_ITEMS.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

/** Formatting toolbar. Formatting isn't part of gameplay, so the controls are disabled. */
export function SheetToolbar({ className }: { className?: string }) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting (not available)"
      className={cn("flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-2 py-1.5", className)}
    >
      <span className="mr-1 rounded border border-slate-200 px-2 py-1 text-[12px] whitespace-nowrap text-slate-400">
        Corporate Sans · 11
      </span>
      {TOOLBAR_GROUPS.map((group, i) => (
        <div key={i} className="flex items-center gap-0.5 border-l border-slate-200 pl-1">
          {group.map((label) => (
            <button
              key={label}
              type="button"
              disabled
              aria-label={label}
              title={`${label} (not available)`}
              className="grid size-7 place-items-center rounded text-[13px] font-semibold text-slate-400"
            >
              {TOOLBAR_GLYPHS[label]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
