import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRpcRoundStore, type RpcCall } from "./rounds/round-store";
import { createVerifiedRoundService, type VerifiedRoundService } from "./rounds/service";

let rpc: RpcCall | null = null;
let roundService: VerifiedRoundService | null = null;

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
