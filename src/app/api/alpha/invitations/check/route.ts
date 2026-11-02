import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { checkInvitation } from "@/server/alpha/service";
import { apiError, rateLimit, readJsonBody, toErrorResponse } from "@/server/http";
import { getTrustedRpc } from "@/server/services";

/**
 * Pre-checks an invitation code for the registration form. Neutral answer
 * ({ valid }), nothing is redeemed, and attempts are limited per network
 * address (hashed in memory, never stored). Codes carry 60 random bits, so
 * guessing is infeasible even without the limit; the database enforces
 * invitations when the account is created.
 */
export async function POST(request: Request) {
  const rpc = getTrustedRpc();
  if (!rpc) return apiError(503, "not_configured", "Accounts aren't configured on this server.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const limited = rateLimit("alpha-invite-check", createHash("sha256").update(address).digest("hex"), 10, 10 * 60_000);
  if (limited) return limited;
  try {
    const body = (await readJsonBody(request, 1_024)) as { code?: unknown };
    return NextResponse.json({ valid: await checkInvitation(rpc, body.code) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
