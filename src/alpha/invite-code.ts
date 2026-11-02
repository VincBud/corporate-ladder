/**
 * Closed alpha invitation codes (server and CLI): "CL-XXXX-XXXX-XXXX", 12
 * characters from Crockford's base32 alphabet (no I, L, O, U), 60 random
 * bits. Only SHA-256 hashes of the normalized code are stored.
 * Self-contained (relative imports only) so scripts can run it with Node.
 */
import { createHash, randomInt } from "node:crypto";
import { INVITE_ALPHABET, INVITE_LENGTH, formatInviteCode, normalizeInviteCode } from "./invite-format.ts";

export { INVITE_ALPHABET, formatInviteCode, looksLikeInviteCode, normalizeInviteCode } from "./invite-format.ts";

/** A new code (cryptographically random, unbiased). */
export function generateInviteCode(random: (max: number) => number = randomInt): string {
  let body = "";
  for (let i = 0; i < INVITE_LENGTH; i++) body += INVITE_ALPHABET[random(INVITE_ALPHABET.length)];
  return formatInviteCode(body);
}

export const inviteCodeHash = (input: string) => createHash("sha256").update(normalizeInviteCode(input), "utf8").digest("hex");
