import { NextResponse, connection } from "next/server";
import { guestOverview } from "@/server/daily/service";
import { rateLimit, toErrorResponse } from "@/server/http";
import { getDailyService } from "@/server/services";
import { createSupabaseServerClient, getVerifiedUser } from "@/lib/supabase/server";

/**
 * Today's Daily Challenges. Signed-in players also get their attempts,
 * official results, standing and recent days; guests get the schedule only.
 */
export async function GET() {
  await connection(); // always per request, never prerendered
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getVerifiedUser(supabase) : null;
  const service = getDailyService();
  const headers = { "Cache-Control": "private, no-store" };
  if (!user || !service) return NextResponse.json(guestOverview(new Date()), { headers });
  const limited = rateLimit("daily", user.id, 120);
  if (limited) return limited;
  try {
    return NextResponse.json(await service.overview(user.id), { headers });
  } catch (error) {
    return toErrorResponse(error);
  }
}
