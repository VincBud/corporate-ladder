import { createHash } from "node:crypto";
import { NextResponse, connection } from "next/server";
import { submitFeedback } from "@/server/feedback/service";
import { apiError, rateLimit, readJsonBody, toErrorResponse } from "@/server/http";
import { getTrustedRpc } from "@/server/services";
import { createSupabaseServerClient, getVerifiedUser } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * Submits the Employee Experience Survey. Signed-in players and guests.
 * Guests are rate-limited per network address in memory (the address is
 * hashed and never stored) and capped globally in the database.
 */
export async function POST(request: Request) {
  await connection(); // always per request, never prerendered
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getVerifiedUser(supabase) : null;
  const rpc = getTrustedRpc();
  if (!rpc) return apiError(503, "not_configured", "Feedback can't be saved on this server right now.");

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const limited = user
    ? rateLimit("feedback", user.id, 10)
    : rateLimit("feedback-guest", createHash("sha256").update(address).digest("hex"), 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    return NextResponse.json(await submitFeedback(rpc, user?.id ?? null, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
