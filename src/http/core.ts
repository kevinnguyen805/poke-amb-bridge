import { mint, MintError, type Principal } from "../spine/mint";
import { looksLikeIngestToken, verifyIngestToken } from "../links/ingestToken";
import { resolve } from "../spine/ingress";
import type { TokenStore, ContinuityStore } from "../spine/store";
import type { RateLimiter } from "../spine/ratelimit";
import type { Msp } from "../spine/msp";
import type { AmbInbound, Clock } from "../spine/types";
import type { SavedLink } from "../links/store";

const SHARE_RATE_MAX = 30;
const SHARE_RATE_WINDOW_SEC = 60;
const INGEST_RATE_MAX = 60;
const INGEST_RATE_WINDOW_SEC = 60;
const INGEST_URL_CAP = 2048;
const INGEST_NOTE_CAP = 512;

/** Transport-agnostic dependencies — shared by the node:http server and the Vercel functions. */
export type CoreDeps = {
  tokens: TokenStore;
  continuity: ContinuityStore;
  msp: Msp;
  clock: Clock;
  businessUuid: string;
  scopedKey: string;
  mspSecret: string;
  rateLimiter?: RateLimiter;
  sessionResolver?: (bearer: string) => { pokeAccountId: string } | undefined;
  /** Link Companion store writer — injected so the ingest endpoint stays DB-agnostic and testable. */
  saveLink?: (userId: string, url: string, note?: string, tags?: string[]) => Promise<SavedLink>;
  /** HMAC secret for per-user `spk_` ingest tokens (Save to Poke Shortcut). Defaults to scopedKey. */
  ingestTokenSecret?: string;
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

function clientIp(h: Headers): string {
  const xff = h["x-forwarded-for"];
  if (xff) return xff.split(",")[0]!.trim();
  return h["x-real-ip"] ?? h["x-vercel-forwarded-for"] ?? "unknown";
}

/** POST /share — the Shortcut/web entry. Credential class determines the token class. */
export async function handleShare(deps: CoreDeps, headers: Headers, rawBody: string): Promise<CoreResult> {
  if (deps.rateLimiter) {
    const { allowed } = await deps.rateLimiter.hit(`share:${clientIp(headers)}`, SHARE_RATE_MAX, SHARE_RATE_WINDOW_SEC);
    if (!allowed) return { status: 429, json: { error: "rate_limited" } };
  }
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

/**
 * POST /links/ingest — save a shared link into the Link Companion store (iOS Shortcut / web entry).
 * Authenticated like /share (x-poke-key scoped key, or a Bearer session). The URL is only STORED,
 * never fetched, so there is no SSRF surface here (that lives in the fetch_link MCP tool).
 */
export async function handleLinkIngest(deps: CoreDeps, headers: Headers, rawBody: string): Promise<CoreResult> {
  if (deps.rateLimiter) {
    const { allowed } = await deps.rateLimiter.hit(
      `links-ingest:${clientIp(headers)}`,
      INGEST_RATE_MAX,
      INGEST_RATE_WINDOW_SEC,
    );
    if (!allowed) return { status: 429, json: { error: "rate_limited" } };
  }
  // Per-user `spk_` ingest token (Save to Poke Shortcut): the token IS the identity — the
  // bound user id comes from the verified token, so a spoofed x-poke-user-id header is inert.
  const presentedKey = headers["x-poke-key"];
  let tokenUserId: string | undefined;
  if (typeof presentedKey === "string" && looksLikeIngestToken(presentedKey)) {
    tokenUserId = await verifyIngestToken(deps.ingestTokenSecret ?? deps.scopedKey, presentedKey);
    if (!tokenUserId) return { status: 401, json: { error: "unauthorized" } };
  } else {
    const principal = principalFromHeaders(headers, deps);
    if (!principal) return { status: 401, json: { error: "unauthorized" } };
    if (principal.kind === "session") tokenUserId = principal.pokeAccountId;
  }
  if (!deps.saveLink) return { status: 500, json: { error: "link store not configured" } };

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody || "{}");
  } catch {
    return { status: 400, json: { error: "invalid json" } };
  }
  const b = (parsedBody ?? {}) as { url?: unknown; note?: unknown; tags?: unknown };

  const url = b.url;
  if (typeof url !== "string" || url.length === 0) return { status: 400, json: { error: "url required" } };
  if (url.length > INGEST_URL_CAP) return { status: 400, json: { error: "url too large" } };
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { status: 400, json: { error: "invalid url" } };
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { status: 400, json: { error: "url scheme not allowed" } };
  }

  const note = typeof b.note === "string" ? b.note.slice(0, INGEST_NOTE_CAP) : undefined;
  const tags = Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === "string") : undefined;
  // Per-user scoping: spk-token and session callers are identified above; legacy scoped-key
  // callers pass the user via the same X-Poke-User-Id header the MCP save_link tool uses.
  const userId = tokenUserId ?? headers["x-poke-user-id"] ?? "anonymous";

  try {
    const saved = await deps.saveLink(userId, url, note, tags && tags.length ? tags : undefined);
    return { status: 201, json: { saved } };
  } catch {
    // A store/DB write failure is transient and server-side — surface it cleanly, not as a raw 500.
    return { status: 503, json: { error: "store_unavailable" } };
  }
}
