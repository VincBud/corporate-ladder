import { connection } from "next/server";
import { handleCompanyRequest } from "@/server/company/http";
import { getCompanyService } from "@/server/services";

/** Public aggregate company snapshot for the current quarter (fictional figures). */
export async function GET(request: Request) {
  await connection(); // always per request, never prerendered
  return handleCompanyRequest(request, getCompanyService());
}
