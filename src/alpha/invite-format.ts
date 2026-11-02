/**
 * Shape rules for alpha invitation codes, safe for the browser (no Node APIs).
 * Must match public.normalize_alpha_invite_code (a PGlite test compares them).
 */
export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_LENGTH = 12;
const VALID = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`);

export const formatInviteCode = (body: string) => `CL-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;

/** Upper case, separators dropped, optional "CL" prefix removed, look-alikes mapped (O→0, I/L→1). */
export function normalizeInviteCode(input: string): string {
  let code = input.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (code.length === INVITE_LENGTH + 2 && code.startsWith("CL")) code = code.slice(2);
  return code.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Whether the input could be a code at all (shape only; validity is decided by the server). */
export const looksLikeInviteCode = (input: string) => VALID.test(normalizeInviteCode(input));
