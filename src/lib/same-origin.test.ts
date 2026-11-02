import { describe, expect, it } from "vitest";
import { isCrossSiteWrite } from "./same-origin";

const req = (overrides: Partial<Parameters<typeof isCrossSiteWrite>[0]> = {}) => ({
  method: "POST",
  origin: "https://alpha.example.com",
  host: "alpha.example.com",
  secFetchSite: "same-origin",
  ...overrides,
});

describe("cross-site write check", () => {
  it("allows same-origin writes and all reads", () => {
    expect(isCrossSiteWrite(req())).toBe(false);
    expect(isCrossSiteWrite(req({ method: "GET", origin: "https://evil.example", secFetchSite: "cross-site" }))).toBe(false);
    expect(isCrossSiteWrite(req({ origin: "http://localhost:3400", host: "localhost:3400" }))).toBe(false);
  });

  it("rejects writes from other origins, sibling sites and opaque origins", () => {
    expect(isCrossSiteWrite(req({ origin: "https://evil.example", secFetchSite: null }))).toBe(true);
    expect(isCrossSiteWrite(req({ secFetchSite: "cross-site" }))).toBe(true);
    expect(isCrossSiteWrite(req({ secFetchSite: "same-site", origin: "https://other.example.com" }))).toBe(true);
    expect(isCrossSiteWrite(req({ origin: "null", secFetchSite: null }))).toBe(true);
    expect(isCrossSiteWrite(req({ method: "patch", origin: "https://evil.example", secFetchSite: null }))).toBe(true);
    expect(isCrossSiteWrite(req({ origin: "not a url", secFetchSite: null }))).toBe(true);
  });

  it("lets non-browser clients through (no cookies to abuse)", () => {
    expect(isCrossSiteWrite(req({ origin: null, secFetchSite: null }))).toBe(false);
  });
});
