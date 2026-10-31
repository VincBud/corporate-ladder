import { NextResponse } from "next/server";
import { updateProfile } from "@/server/career/service";
import { rateLimit, readJsonBody, requireUser, toErrorResponse } from "@/server/http";

/** Updates the signed-in player's display name. Departments change through POST /api/department. */
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("profile", auth.user.id, 20);
  if (limited) return limited;
  try {
    const body = await readJsonBody(request, 2_048);
    return NextResponse.json(await updateProfile(auth.supabase, auth.user.id, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
