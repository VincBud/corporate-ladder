"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { BriefcaseIcon, BuildingIcon, CloseIcon, GamepadIcon, type IconProps } from "@/components/icons";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/cn";

interface Step {
  icon: ComponentType<IconProps>;
  tint: string;
  heading: string;
  body: string;
}

function stepsFor(signedIn: boolean): Step[] {
  return [
    {
      icon: BuildingIcon,
      tint: "from-sky-500 to-blue-800",
      heading: "You've been hired. Somehow.",
      body: "Welcome to the world's most questionably managed corporation. Play office challenges, climb the career ladder, and help build our company.",
    },
    {
      icon: GamepadIcon,
      tint: "from-emerald-500 to-teal-700",
      heading: "Your performance matters.",
      // Guests play locally: never promise them verified rewards.
      body: signedIn
        ? "Complete fast-paced office challenges, earn Corporate XP and get promoted. Every verified assignment also contributes to our shared company."
        : "Complete fast-paced office challenges, earn Corporate XP and get promoted. With a free account, every verified assignment also contributes to our shared company.",
    },
    {
      icon: BriefcaseIcon,
      tint: "from-rose-400 to-fuchsia-700",
      heading: "Choose your own career.",
      body: "Join Finance, Sales, HR or another department. Your department defines your career path, but you can still play every game.",
    },
  ];
}

interface OrientationProps {
  signedIn: boolean;
  /** Final step: remember completion, close, and open the first assignment. */
  onComplete: () => void;
  /** Skip, close or Escape: remember dismissal and close. */
  onDismiss: () => void;
}

/** Three-screen Employee Orientation. Modal, keyboard friendly, always escapable. */
export function Orientation({ signedIn, onComplete, onDismiss }: OrientationProps) {
  const [index, setIndex] = useState(0);
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const steps = stepsFor(signedIn);
  const step = steps[index];
  const last = index === steps.length - 1;
  const Icon = step.icon;

  // Focus the primary action on open and after every step change.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Keep Tab inside the dialog (it is modal).
  function trapTab(event: React.KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="absolute inset-0 z-[960] grid place-items-center bg-desk-950/60 p-4 backdrop-blur-[2px]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        aria-describedby={`${id}-body`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onDismiss();
          }
          trapTab(event);
        }}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line-strong bg-desk-900 shadow-popover motion-safe:animate-pop-in"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">
            Employee Orientation · {BRAND.company}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close orientation"
            className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
          >
            <CloseIcon className="size-4" />
          </button>
        </header>

        <div key={index} className="px-6 pt-7 pb-5 text-center motion-safe:animate-view-in">
          <span
            aria-hidden="true"
            className={cn("mx-auto grid size-18 place-items-center rounded-2xl bg-linear-to-br text-white shadow-lg ring-1 ring-white/20 ring-inset", step.tint)}
          >
            <Icon className="size-9" />
          </span>
          <p className="sr-only" aria-live="polite">
            Step {index + 1} of {steps.length}
          </p>
          <h2 id={`${id}-heading`} className="mt-5 text-xl font-semibold tracking-tight text-balance">
            {step.heading}
          </h2>
          <p id={`${id}-body`} className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted text-pretty">
            {step.body}
          </p>
          {last && !signedIn && (
            <p className="mx-auto mt-3 max-w-sm text-xs text-fg-subtle">
              You&apos;re a guest: practice rounds are saved in this browser only. Sign in any time from Employee Profile for verified play.
            </p>
          )}
        </div>

        <div aria-hidden="true" className="flex justify-center gap-1.5 pb-4">
          {steps.map((s, i) => (
            <span key={s.heading} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-6 bg-accent" : i < index ? "w-1.5 bg-accent/50" : "w-1.5 bg-white/15")} />
          ))}
        </div>

        <footer className="flex items-center gap-2 border-t border-line bg-white/2 px-4 py-3">
          <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-white/6 hover:text-fg">
            Skip
          </button>
          <div className="ml-auto flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="rounded-lg bg-white/6 px-3 py-1.5 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10"
              >
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (last ? onComplete() : setIndex(index + 1))}
              className="rounded-lg bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent"
            >
              {last ? "Play your first assignment" : "Next"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
