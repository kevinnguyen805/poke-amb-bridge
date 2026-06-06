// Spine data model — field names are the single source of truth reused across mint, ingress, egress.
// Mirrors "The Spine: Token Lifecycle & Contracts" in the plan. No drift permitted.

export type TokenClass = "anonymous" | "account-bound";
export type Intent = "share" | "open_chat" | "signup" | "invite";
export type LinkSource =
  | "shortcut"
  | "vcard"
  | "qr"
  | "nfc"
  | "wallet"
  | "banner"
  | "invitation"
  | "imessage_cta"
  | "cold";

export type SharedPayload = {
  kind: "url" | "text" | "image" | "file";
  url?: string;
  text?: string;
  assetId?: string;
  note?: string;
  source?: string;
};

/** SHARE_TOKENS (short-TTL KV) — the minted token record. */
export type ShareTokenRecord = {
  token: string;
  tokenClass: TokenClass;
  intent: Intent;
  linkSource: LinkSource;
  pokeAccountIdRef?: string; // account-bound ONLY — server-stamped ref, never raw PII
  consentRef?: string; // account-bound ONLY
  payload: SharedPayload;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 = createdAt + ttl
  ttl: number; // seconds (anonymous=900, account-bound=120)
  consumedAt?: string; // set via compare-and-set on first resolution; single-use
  consumedBy?: string; // opaqueId that consumed the token
};

export type AgentState = "agent" | "human" | "awaiting_human";

/** CONTINUITY (durable) — the link registry (idempotent on opaqueId). */
export type ContinuityLink = {
  opaqueId: string; // PRIMARY KEY (VL-2: keyed to Apple Account)
  handleEnc?: string; // FIELD-ENCRYPTED handle; set ONLY via authenticated+consented bind path
  pokeAccountId?: string;
  consentRef?: string;
  consentAt?: string;
  agentState: AgentState;
  firstLinkedAt: string;
  lastSeenAt: string;
  lastInboundAt: string; // drives the hard 24h-window egress check
  linkedVia: Intent;
  linkSource: LinkSource;
  alwaysReplyOnAMB?: boolean; // SUBORDINATE to the 24h-window check
  relinkOf?: string; // authenticated, user-confirmed re-link only
};

/** Normalized inbound message at the MSP-facing ingress. */
export type AmbInbound = {
  opaqueId: string;
  bizIntentId?: Intent;
  bizGroupId?: string;
  body: string;
  receivedAt: string;
  capabilities?: string[];
};

/** A message bound for the AMB channel. The middleware stamps the compliance fields. */
export type AmbOutbound = {
  text?: string;
  isFreeForm: boolean; // free-form vs. session reply (List Picker/Form inside an open session)
  agentAuto?: boolean; // an automated agent reply (suppressed while a human owns the turn)
  aiLabeled?: boolean; // stamped by sendAmb
  escalation?: boolean; // stamped by sendAmb
  applePresentation?: boolean; // stamped by sendAmb
};

/** Injected clock so TTL and 24h-window math are deterministic in tests. */
export type Clock = { now(): Date };
export const systemClock: Clock = { now: () => new Date() };
