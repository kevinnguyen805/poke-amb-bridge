/**
 * Per-user ingest tokens for the "Save to Poke" Shortcut — `spk_<base64url(userId)>.<mac>`.
 *
 * Self-authenticating: the token CARRIES the user id and an HMAC over it, so the server
 * verifies statelessly (no key table, no migration) and the same user always gets the same
 * token back (idempotent re-setup). The token is a WRITE-ONLY capability — it is accepted
 * only by /links/ingest, never by any read path — so a leaked token can at worst add links
 * to its own list. Revocation is global (rotate the secret), accepted for this tier.
 */

const PREFIX = "spk_";
const MAC_HEX_LEN = 32; // 16 bytes of HMAC-SHA256 — ample for a write-only capability

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | undefined {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function mac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, MAC_HEX_LEN);
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function looksLikeIngestToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

export async function mintIngestToken(secret: string, userId: string): Promise<string> {
  if (!userId || userId === "anonymous") throw new Error("a real user id is required to mint an ingest token");
  return `${PREFIX}${b64urlEncode(userId)}.${await mac(secret, userId)}`;
}

/** Returns the bound user id when the token verifies, else undefined. */
export async function verifyIngestToken(secret: string, token: string): Promise<string | undefined> {
  if (!looksLikeIngestToken(token)) return undefined;
  const rest = token.slice(PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const userId = b64urlDecode(rest.slice(0, dot));
  if (!userId || userId === "anonymous") return undefined;
  return safeEq(rest.slice(dot + 1), await mac(secret, userId)) ? userId : undefined;
}
