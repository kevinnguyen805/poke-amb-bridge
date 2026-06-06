import { describe, it, expect } from "vitest";
import { generateToken, isValidToken, TOKEN_RE } from "../src/spine/token";

describe("base62 token codec", () => {
  it("generates a 22-char base62 token", () => {
    expect(generateToken()).toMatch(/^[0-9A-Za-z]{22}$/);
  });

  it("generates unique tokens across many calls (CSPRNG)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateToken());
    expect(seen.size).toBe(2000);
  });

  it("validates a freshly generated token", () => {
    expect(isValidToken(generateToken())).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidToken("abc")).toBe(false);
    expect(isValidToken("a".repeat(21))).toBe(false);
    expect(isValidToken("a".repeat(23))).toBe(false);
  });

  it("rejects non-base62 characters and the poke: prefix", () => {
    expect(isValidToken("a".repeat(21) + "-")).toBe(false);
    expect(isValidToken("poke:" + "a".repeat(22))).toBe(false);
    expect(isValidToken("a".repeat(21) + "_")).toBe(false);
  });

  it("exposes the canonical anchor regex used by the ingress parser", () => {
    expect(TOKEN_RE.source).toBe("^[0-9A-Za-z]{22}$");
  });
});
