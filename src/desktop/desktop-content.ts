/** Fictional office flavor for desktop widgets. Not user data. */

export const NEXT_MEETING = {
  title: "Alignment on Alignment",
  time: "2:00 – 3:30 PM",
  location: "Synergy Room 4B (no chairs)",
  attendees: 47,
  agendaItems: 0,
} as const;

export const ANNOUNCEMENT = {
  source: "Office of the CEO",
  title: "Kitchen rebrand complete",
  body: "The 4th-floor kitchen is now a Collaboration Hub. Microwave access requires a booking.",
  posted: "Posted today",
} as const;

export const PRODUCTIVITY = {
  value: 71.4,
  change: "+0.2 vs. last quarter",
  verdict: "Trending sideways",
  note: "Methodology confidential. Keep moving your mouse.",
  history: [62, 64, 61, 66, 65, 69, 68, 71.4],
} as const;
