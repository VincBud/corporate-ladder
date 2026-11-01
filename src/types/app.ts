export const APP_IDS = [
  "spreadsheet-wars",
  "pipeline-panic",
  "career",
  "leaderboard",
  "profile",
  "company",
  "departments",
] as const;

export type AppId = (typeof APP_IDS)[number];
