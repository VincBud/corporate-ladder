import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRpcRoundStore, type RpcCall } from "./rounds/round-store";
import { createVerifiedRoundService, type VerifiedRoundService } from "./rounds/service";
import { createCompanyService, type CompanyService } from "./company/service";
import { createPipelineRoundService, type PipelineRoundService } from "./pipeline/service";

let rpc: RpcCall | null = null;
let roundService: VerifiedRoundService | null = null;
let companyService: CompanyService | null = null;
let pipelineService: PipelineRoundService | null = null;

/** Service-role RPC into the trusted SQL functions. Null when the server isn't configured. */
export function getTrustedRpc(): RpcCall | null {
  if (!rpc) {
    const admin = getSupabaseAdminClient();
    if (!admin) return null;
    rpc = async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    };
  }
  return rpc;
}

export function getRoundService(): VerifiedRoundService | null {
  if (!roundService) {
    const call = getTrustedRpc();
    if (!call) return null;
    roundService = createVerifiedRoundService({ store: createRpcRoundStore(call) });
  }
  return roundService;
}

export function getCompanyService(): CompanyService | null {
  if (!companyService) {
    const call = getTrustedRpc();
    if (!call) return null;
    companyService = createCompanyService({ rpc: call });
  }
  return companyService;
}

export function getPipelineService(): PipelineRoundService | null {
  if (!pipelineService) {
    const call = getTrustedRpc();
    if (!call) return null;
    pipelineService = createPipelineRoundService({ store: createRpcRoundStore(call) });
  }
  return pipelineService;
}
