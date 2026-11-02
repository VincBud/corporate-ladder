import { NextResponse, connection } from "next/server";
import { getAlphaAccess } from "@/server/alpha/service";
import { toErrorResponse } from "@/server/http";
import { getTrustedRpc } from "@/server/services";

/** Whether creating an account needs an alpha invitation (public, no secrets). */
export async function GET() {
  await connection(); // always per request, never prerendered
  try {
    return NextResponse.json(await getAlphaAccess(getTrustedRpc()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
