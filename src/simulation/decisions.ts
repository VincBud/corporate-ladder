/**
 * Future strategic decisions. The engine already applies their effects as
 * quarter modifiers (see StrategicModifier); choosing or voting on them
 * isn't implemented.
 */
import type { StrategicModifier } from "./economy";

export interface PlannedDecision extends StrategicModifier {
  description: string;
  status: "planned";
}

export const PLANNED_DECISIONS: readonly PlannedDecision[] = [
  {
    id: "regional-office",
    label: "Open a regional office",
    description: "More revenue, more rent, more people asking where the stapler is.",
    revenueMultiplier: 1.06,
    costMultiplier: 1.05,
    status: "planned",
  },
  {
    id: "kombucha-tap",
    label: "Replace the coffee machine with a kombucha tap",
    description: "Morale impact under review. Productivity impact hotly debated.",
    costMultiplier: 0.995,
    status: "planned",
  },
  {
    id: "four-day-week",
    label: "Four-day work week pilot",
    description: "Same output, fewer days. Allegedly.",
    costMultiplier: 0.98,
    revenueMultiplier: 0.99,
    status: "planned",
  },
];
