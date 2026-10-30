import { GridIcon, IdBadgeIcon, LadderIcon, TrophyIcon } from "@/components/icons";
import { APP_IDS, type AppId } from "@/types/app";
import { CareerApp } from "./career/career-app";
import { LeaderboardApp } from "./leaderboard/leaderboard-app";
import { ProfileApp } from "./profile/profile-app";
import { SpreadsheetWarsApp } from "./spreadsheet-wars/spreadsheet-wars-app";
import type { AppDefinition } from "./types";

const APP_REGISTRY: Record<AppId, AppDefinition> = {
  "spreadsheet-wars": {
    id: "spreadsheet-wars",
    title: "Spreadsheet Wars",
    description: "Competitive spreadsheet combat. Preview build.",
    icon: GridIcon,
    tint: "from-emerald-500 to-teal-700",
    // The spreadsheet is the main event: open at ~80% of the workspace.
    window: { initial: { fraction: 0.8 }, min: { width: 640, height: 420 } },
    component: SpreadsheetWarsApp,
  },
  career: {
    id: "career",
    title: "Corporate Career",
    description: "Your rank, level and path to the corner office.",
    icon: LadderIcon,
    tint: "from-amber-400 to-amber-700",
    window: { initial: { width: 780, height: 620 }, min: { width: 420, height: 360 } },
    component: CareerApp,
  },
  leaderboard: {
    id: "leaderboard",
    title: "Leaderboard",
    description: "See who is climbing fastest.",
    icon: TrophyIcon,
    tint: "from-indigo-400 to-indigo-700",
    window: { initial: { width: 860, height: 600 }, min: { width: 460, height: 360 } },
    component: LeaderboardApp,
  },
  profile: {
    id: "profile",
    title: "Employee Profile",
    description: "Your badge, achievements and settings.",
    icon: IdBadgeIcon,
    tint: "from-slate-400 to-slate-700",
    window: { initial: { width: 740, height: 620 }, min: { width: 420, height: 360 } },
    component: ProfileApp,
  },
};

export const APPS: readonly AppDefinition[] = APP_IDS.map((id) => APP_REGISTRY[id]);

export function getApp(appId: AppId): AppDefinition {
  return APP_REGISTRY[appId];
}
