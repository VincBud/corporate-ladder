export const APP_IDS = [
  "spreadsheet-wars",
  "career",
  "leaderboard",
  "profile",
] as const;

export type AppId = (typeof APP_IDS)[number];
