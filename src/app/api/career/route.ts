import { NextResponse } from "next/server";
import { getCareer } from "@/server/career/service";
import { syncAchievementsSafely } from "@/server/achievements/service";
import { rateLimit, requireUser, toErrorResponse } from "@/server/http";
import { getTrustedRpc } from "@/server/services";

/** The signed-in player's profile, XP and history (read under Row Level Security). */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("career", auth.user.id, 120);
  if (limited) return limited;
  try {
    const career = await getCareer(auth.supabase, auth.user.id);
    // Also the backfill/recovery path: evaluates verified history and awards anything missing.
    const achievements = await syncAchievementsSafely(getTrustedRpc(), auth.user.id);
    return NextResponse.json(
      { ...career, achievements: achievements ? { summary: achievements.summary, newlyUnlocked: achievements.created } : null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
