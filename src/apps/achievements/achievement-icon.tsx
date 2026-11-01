import type { ComponentType } from "react";
import {
  BriefcaseIcon,
  BuildingIcon,
  CheckIcon,
  ClockIcon,
  FunnelIcon,
  GridIcon,
  IdBadgeIcon,
  LadderIcon,
  SparkleIcon,
  TrophyIcon,
  type IconProps,
} from "@/components/icons";
import type { AchievementIcon as IconKey, AchievementRarity } from "@/career/achievements";
import type { BadgeTone } from "@/components/ui/badge";

const ICONS: Record<IconKey, ComponentType<IconProps>> = {
  badge: IdBadgeIcon,
  check: CheckIcon,
  sparkle: SparkleIcon,
  clock: ClockIcon,
  grid: GridIcon,
  funnel: FunnelIcon,
  ladder: LadderIcon,
  briefcase: BriefcaseIcon,
  building: BuildingIcon,
  trophy: TrophyIcon,
};

export function AchievementGlyph({ icon, className }: { icon: IconKey; className?: string }) {
  const Glyph = ICONS[icon];
  return <Glyph className={className} />;
}

export const RARITY: Record<AchievementRarity, { label: string; tone: BadgeTone }> = {
  common: { label: "Common", tone: "neutral" },
  uncommon: { label: "Uncommon", tone: "success" },
  rare: { label: "Rare", tone: "accent" },
  epic: { label: "Epic", tone: "gold" },
};
