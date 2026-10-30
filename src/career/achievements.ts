import type { Achievement } from "@/types/career";

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "badge-activated", title: "Badge Activated", description: "Logged in for the first time. HR has been notified." },
  { id: "first-win", title: "First Win", description: "Win your first Spreadsheet Wars match." },
  { id: "reply-all-survivor", title: "Reply-All Survivor", description: "Endure a 400-person reply-all thread without unsubscribing." },
  { id: "inbox-zero", title: "Inbox Zero", description: "Reach zero unread messages. Even once." },
  { id: "first-promotion", title: "Upwardly Mobile", description: "Earn your first promotion." },
  { id: "synergy-achieved", title: "Synergy Achieved", description: "Nobody knows how. Least of all you." },
];
