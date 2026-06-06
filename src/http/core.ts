import { mint, MintError, type Principal } from "../spine/mint";
import { resolve } from "../spine/ingress";
import type { TokenStore, ContinuityStore } from "../spine/store";
import type { Msp } from "../spine/msp";
import type { AmbInbound, Clock } from "../spine/types";

/** Transport-agnostic dependencies — shared by the node:http server and the Vercel functions. */
export type CoreDeps = {
  tokens: TokenStore;
  continuity: ContinuityStore;
  msp: Msp;
  clock: Clock;
  businessUuid: string;
  scopedKey: string;
  mspSecret: string;
  sessionResolver?: (bearer: string) => { pokeAccountId: string } | undefined;
};

export type Headers = Record<string, string | undefined>;
export type CoreResult = { status: number; json: unknown };

/** Constant-time string comparison (no early-out on first mismatch). */
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function defaultSessionResolver(bearer: string): { pokeAccountId: string } | undefined {
  return bearer.startsWith("session_") ? { pokeAccountId: bearer.slice("session_".length) } : undefined;
}

export function principalFromHeaders(headers: Headers, deps: CoreDeps): Principal | undefined {
  const key = headers["x-poke-key"];
  if (typeof key === "string" && safeEq(key, deps.scopedKey)) return { kind: "scoped-key" };
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const s = (deps.sessionResolver ?? defaultSessionResolver)(auth.slice(7));
    if (s) return { kind: "session", pokeAccountId: s.pokeAccountId };
  }
  return undefined;
}

export async function verifyHmac(raw: string, sig: string | undefined, secret: string): Promise<boolean> {
  if (typeof sig !== "string") return false;
  return safeEq(sig, await hmacHex(secret, raw));
}

/** POST /share — the Shortcut/web entry. Credential class determines the token class. */
export async function handleShare(deps: CoreDeps, headers: Headers, rawBody: string): Promise<CoreResult> {
  const principal = principalFromHeaders(headers, deps);
  if (!principal) return { status: 401, json: { error: "unauthorized" } };
  let body: { payload?: unknown };
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return { status: 400, json: { error: "invalid json" } };
  }
  if (!body || typeof body !== "object" || !body.payload) return { status: 400, json: { error: "payload required" } };
  try {
    const result = await mint({ tokens: deps.tokens, businessUuid: deps.businessUuid, clock: deps.clock }, principal, body as never);
    return { status: 201, json: result };
  } catch (e) {
    if (e instanceof MintError) return { status: e.status, json: { error: e.message } };
    throw e;
  }
}

/** POST /amb/ingress — the MSP webhook. HMAC-verified. */
export async function handleIngress(deps: CoreDeps, headers: Headers, rawBody: string): Promise<CoreResult> {
  if (!(await verifyHmac(rawBody, headers["x-msp-signature"], deps.mspSecret))) {
    return { status: 401, json: { error: "bad signature" } };
  }
  let inbound: AmbInbound;
  try {
    inbound = JSON.parse(rawBody);
  } catch {
    return { status: 400, json: { error: "invalid json" } };
  }
  const out = await resolve(
    { tokens: deps.tokens, continuity: deps.continuity, msp: deps.msp, clock: deps.clock },
    inbound,
  );
  return { status: 200, json: { branch: out.branch, accountBound: out.accountBound, routedIntent: out.routedIntent } };
}
