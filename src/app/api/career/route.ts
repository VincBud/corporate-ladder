import { NextResponse } from "next/server";
import { getCareer } from "@/server/career/service";
import { rateLimit, requireUser, toErrorResponse } from "@/server/http";

/** The signed-in player's profile, XP and history (read under Row Level Security). */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("career", auth.user.id, 120);
  if (limited) return limited;
  try {
    return NextResponse.json(await getCareer(auth.supabase, auth.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
