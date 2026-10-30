import type { Rank } from "@/types/career";

/** The corporate ladder, lowest rung first. */
export const RANKS: readonly Rank[] = [
  { id: "unpaid-intern", title: "Unpaid Intern", minLevel: 1, salary: 0, perk: "Paid in exposure and leftover sandwiches." },
  { id: "intern", title: "Intern", minLevel: 3, salary: 18_000, perk: "A lanyard. Your own lanyard." },
  { id: "junior-associate", title: "Junior Associate", minLevel: 5, salary: 42_000, perk: "Access to the good stapler." },
  { id: "associate", title: "Associate", minLevel: 8, salary: 58_000, perk: "Invited to meetings. Expected to attend them." },
  { id: "senior-associate", title: "Senior Associate", minLevel: 12, salary: 74_000, perk: "May say “circle back” without irony." },
  { id: "team-lead", title: "Team Lead", minLevel: 16, salary: 92_000, perk: "Responsibility without authority." },
  { id: "manager", title: "Manager", minLevel: 20, salary: 115_000, perk: "An office door. It does not close." },
  { id: "senior-manager", title: "Senior Manager", minLevel: 25, salary: 140_000, perk: "Your calendar becomes public property." },
  { id: "director", title: "Director", minLevel: 30, salary: 175_000, perk: "A corner-adjacent office." },
  { id: "vice-president", title: "Vice President", minLevel: 36, salary: 230_000, perk: "One of 214 Vice Presidents." },
  { id: "senior-vice-president", title: "Senior Vice President", minLevel: 42, salary: 310_000, perk: "Can approve system shutdowns." },
  { id: "chief-synergy-officer", title: "Chief Synergy Officer", minLevel: 50, salary: 520_000, perk: "Nobody knows what you do. Including you." },
  { id: "ceo", title: "CEO", minLevel: 60, salary: 1_000_000, perk: "Promoted for doing nothing. Mission accomplished." },
];
