/**
 * Developer-only management of closed alpha invitations. Uses the service
 * role key from an env file (that key is the access control; never ship it to
 * a browser). Codes are shown once, when created, and never stored or logged.
 *
 *   npm run alpha:invites -- create --count 5 --days 14 --note "wave 1"
 *   npm run alpha:invites -- list
 *   npm run alpha:invites -- revoke <invitation id or first 8+ characters>
 *   npm run alpha:invites -- require on|off|status
 *
 * Target another project with --env <file> (default .env.local), e.g.
 *   npm run alpha:invites -- --env .env.alpha.local list
 */
import { readFileSync } from "node:fs";
import { generateInviteCode, inviteCodeHash } from "../src/alpha/invite-code.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const envFile = option("env") ?? ".env.local";
const count = Number(option("count") ?? 1);
const days = Number(option("days") ?? 14);
const note = option("note");
const [command, argument] = args;

const env = Object.fromEntries(
  readFileSync(new URL(`../${envFile}`, import.meta.url), "utf8")
    .split("\n")
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2]]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error(`NEXT_PUBLIC_SUPABASE_URL and a service role key are required in ${envFile}.`);
console.error(`Target project: ${new URL(url).hostname.split(".")[0]} (from ${envFile})`);

async function rpc(fn: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${fn} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

switch (command) {
  case "create": {
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("--count must be 1–100.");
    if (!Number.isFinite(days) || days <= 0 || days > 180) throw new Error("--days must be more than 0 and at most 180.");
    const codes = Array.from({ length: count }, () => generateInviteCode());
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    const created = (await rpc("create_alpha_invitations", { p_code_hashes: codes.map(inviteCodeHash), p_expires_at: expiresAt, p_note: note ?? null })) as { id: string }[];
    console.log(`Created ${created.length} invitation(s), valid until ${day(expiresAt)} UTC. Each code creates one account.`);
    console.log("Codes are shown only now. Send each to one tester over a private channel; don't commit or paste them anywhere shared.\n");
    created.forEach((row, i) => console.log(`${codes[i]}   (id ${row.id.slice(0, 8)})`));
    break;
  }
  case "list": {
    const data = (await rpc("list_alpha_invitations")) as {
      invite_required: boolean;
      invitations: { id: string; note: string | null; status: string; created_at: string; expires_at: string; redeemed_at: string | null }[];
    };
    console.log(`Invitations required for new accounts: ${data.invite_required ? "yes" : "NO (sign-up is open)"}\n`);
    for (const i of data.invitations) {
      console.log(`${i.id.slice(0, 8)}  ${i.status.padEnd(40)} expires ${day(i.expires_at)}  redeemed ${day(i.redeemed_at)}  ${i.note ?? ""}`);
    }
    const tally = data.invitations.reduce<Record<string, number>>((acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc), {});
    console.log(`\n${data.invitations.length} total: ${Object.entries(tally).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}`);
    break;
  }
  case "revoke": {
    if (!argument) throw new Error("Usage: revoke <invitation id or first 8+ characters>");
    const result = (await rpc("revoke_alpha_invitation", { p_id_prefix: argument })) as { id: string; revoked_at: string };
    console.log(`Revoked ${result.id} at ${day(result.revoked_at)} UTC.`);
    break;
  }
  case "require": {
    if (argument === "on" || argument === "off") await rpc("set_alpha_invite_required", { p_required: argument === "on" });
    else if (argument !== "status") throw new Error("Usage: require on|off|status");
    const access = (await rpc("get_alpha_access")) as { invite_required: boolean };
    console.log(`Invitations required for new accounts: ${access.invite_required ? "yes" : "no"}`);
    break;
  }
  default:
    console.log("Usage: npm run alpha:invites -- [--env <file>] create [--count N] [--days D] [--note text] | list | revoke <id> | require on|off|status");
    process.exitCode = 1;
}
