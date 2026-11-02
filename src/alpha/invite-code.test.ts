import { describe, expect, it } from "vitest";
import { INVITE_ALPHABET, generateInviteCode, inviteCodeHash, looksLikeInviteCode, normalizeInviteCode } from "./invite-code";

describe("invitation codes", () => {
  it("generates well-formed, distinct codes from the unambiguous alphabet", () => {
    const codes = Array.from({ length: 2000 }, () => generateInviteCode());
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^CL-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(code.slice(3)).not.toMatch(/[ILOU]/);
      expect(looksLikeInviteCode(code)).toBe(true);
    }
  });

  it("uses every alphabet character (no bias toward a subset)", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteCode()).join("").replace(/^CL|-/g, ""));
    for (const ch of INVITE_ALPHABET) expect(seen.has(ch)).toBe(true);
  });

  it("normalizes typing variations to the same code and hash", () => {
    const variants = ["CL-7K2M-9QXA-4T0B", "cl 7k2m 9qxa 4t0b", "7K2M9QXA4T0B", "  cl-7k2m-9qxa-4tob ", "CL7K2M9QXA4T0B"];
    expect(new Set(variants.map(normalizeInviteCode))).toEqual(new Set(["7K2M9QXA4T0B"]));
    expect(new Set(variants.map(inviteCodeHash)).size).toBe(1);
    expect(normalizeInviteCode("il1l")).toBe("1111");
  });

  it("rejects malformed input by shape", () => {
    for (const bad of ["", "CL-1234", "CL-1234-5678-901U", "not a code at all"]) expect(looksLikeInviteCode(bad)).toBe(false);
  });

  it("hashes with SHA-256 of the normalized code", () => {
    expect(inviteCodeHash("CL-0000-0000-0000")).toMatch(/^[0-9a-f]{64}$/);
    expect(inviteCodeHash("CL-0000-0000-0000")).not.toBe(inviteCodeHash("CL-0000-0000-0001"));
  });
});
