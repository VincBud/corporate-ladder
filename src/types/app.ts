export const APP_IDS = [
  "spreadsheet-wars",
  "career",
  "leaderboard",
  "profile",
  "company",
  "departments",
] as const;

export type AppId = (typeof APP_IDS)[number];
