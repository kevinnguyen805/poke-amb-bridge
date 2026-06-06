import { randomBytes } from "node:crypto";

// base62 token: 22 chars ≈ 131 bits — opaque, collision-safe, non-guessable (spine §"Canonical conventions").
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LEN = 22;

/** The anchor regex the ingress parser uses to extract `poke:<token>`. */
export const TOKEN_RE = /^[0-9A-Za-z]{22}$/;

/**
 * Generate a 22-char base62 token from a CSPRNG.
 * Rejection sampling (drop bytes >= 248 = 4×62) avoids modulo bias.
 */
export function generateToken(): string {
  let out = "";
  while (out.length < LEN) {
    const bytes = randomBytes(LEN);
    for (let i = 0; i < bytes.length && out.length < LEN; i++) {
      const b = bytes[i]!;
      if (b < 248) out += ALPHABET[b % 62]!;
    }
  }
  return out;
}

export function isValidToken(s: string): boolean {
  return TOKEN_RE.test(s);
}
