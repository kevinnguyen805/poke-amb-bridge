import { sendAmb, type EgressDeps } from "./egress";
import type { InMemoryTokenStore, InMemoryContinuityStore } from "./store";
import type { Msp } from "./msp";
import type { AmbInbound, Clock, ContinuityLink, Intent, LinkSource, SharedPayload } from "./types";

export type ResolveDeps = {
  tokens: InMemoryTokenStore;
  continuity: InMemoryContinuityStore;
  msp: Msp;
  clock: Clock;
  isConsentValid?: (ref: string) => boolean;
  circuitBreaker?: { isOpen(linkSource: LinkSource): boolean };
};

export type ResolveBranch = "expired" | "foreign-reject" | "replay" | "bound" | "invite" | "cold";

export type ResolveOutcome = {
  branch: ResolveBranch;
  opaqueId: string;
  link: ContinuityLink;
  routedIntent?: Intent;
  accountBound: boolean;
};

const TOKEN_BODY_RE = /^poke:([0-9A-Za-z]{22})$/;
const LINK_SOURCES: readonly string[] = [
  "shortcut", "vcard", "qr", "nfc", "wallet", "banner", "invitation", "imessage_cta", "cold",
];

function asLinkSource(s: string | undefined, fallback: LinkSource): LinkSource {
  return s && LINK_SOURCES.includes(s) ? (s as LinkSource) : fallback;
}

/** Default INTENT_ROUTES — each handler emits ONLY through sendAmb (labeled + window-checked). */
function routeIntent(egress: EgressDeps, intent: Intent, opaqueId: string, payload?: SharedPayload): void {
  const text =
    intent === "share"
      ? `What should I do with this? ${payload?.url ?? payload?.text ?? "(shared item)"}`
      : intent === "open_chat"
        ? "Hey — what can I help with?"
        : intent === "signup"
          ? "Let's set up your Poke account."
          : "Picking up where we left off.";
  sendAmb(egress, opaqueId, { text, isFreeForm: false, agentAuto: true });
}

/**
 * Deterministic branch precedence (plan §"Resolution algorithm"). Exactly one outcome.
 * Always upserts lastSeen/lastInbound first; single-use enforced by the token store's CAS.
 */
export function resolve(deps: ResolveDeps, inbound: AmbInbound): ResolveOutcome {
  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const egress: EgressDeps = {
    continuity: deps.continuity,
    msp: deps.msp,
    clock: deps.clock,
    ...(deps.circuitBreaker ? { circuitBreaker: deps.circuitBreaker } : {}),
  };
  const isConsentValid = deps.isConsentValid ?? ((r: string) => !!r);

  // 1. Always upsert lastSeen / lastInbound first.
  const base: ContinuityLink = deps.continuity.get(inbound.opaqueId) ?? {
    opaqueId: inbound.opaqueId,
    agentState: "agent",
    firstLinkedAt: nowIso,
    lastSeenAt: nowIso,
    lastInboundAt: nowIso,
    linkedVia: "open_chat",
    linkSource: "cold",
  };
  base.lastSeenAt = nowIso;
  base.lastInboundAt = nowIso;

  const token = TOKEN_BODY_RE.exec(inbound.body.trim())?.[1];

  if (token) {
    const record = deps.tokens.get(token);
    const expired = !record || Date.parse(record.expiresAt) < now.getTime();

    // Branch 2a — missing/expired: anonymous link, degraded reply, no bind, no consume.
    if (expired) {
      base.linkedVia = inbound.bizIntentId ?? "open_chat";
      base.linkSource = record?.linkSource ?? asLinkSource(inbound.bizGroupId, "shortcut");
      deps.continuity.put(base);
      sendAmb(egress, inbound.opaqueId, { text: "That link expired — let's start fresh.", isFreeForm: false, agentAuto: true });
      return { branch: "expired", opaqueId: inbound.opaqueId, link: base, accountBound: false };
    }

    const c = deps.tokens.consume(token, inbound.opaqueId, nowIso);

    // Branch 2b — consumed by a different opaqueId: reject, no merge, no bind.
    if (c.status === "foreign") {
      deps.continuity.put(base);
      sendAmb(egress, inbound.opaqueId, { text: "Let's start fresh.", isFreeForm: false, agentAuto: true });
      return { branch: "foreign-reject", opaqueId: inbound.opaqueId, link: base, accountBound: false };
    }

    // Branch 2c — replay by the same opaqueId: idempotent, no re-process, no reply.
    if (c.status === "replay") {
      deps.continuity.put(base);
      return { branch: "replay", opaqueId: inbound.opaqueId, link: base, accountBound: false };
    }

    // Branch 2d — CAS winner: link, gate account binding, route.
    const rec = c.record!;
    base.linkedVia = rec.intent;
    base.linkSource = rec.linkSource;
    let accountBound = false;
    if (rec.tokenClass === "account-bound" && rec.consentRef && isConsentValid(rec.consentRef)) {
      base.pokeAccountId = rec.pokeAccountIdRef;
      base.consentRef = rec.consentRef;
      base.consentAt = nowIso;
      // handleEnc is populated from the account's stored field-encrypted handle (not from the KV
      // token, which holds no raw PII) — omitted in this reference impl.
      accountBound = true;
    }
    deps.continuity.put(base);
    routeIntent(egress, rec.intent, inbound.opaqueId, rec.payload);
    return { branch: "bound", opaqueId: inbound.opaqueId, link: base, routedIntent: rec.intent, accountBound };
  }

  // Branch 3 — no token but an Invitation acceptance (VL-6).
  if (inbound.bizIntentId === "invite") {
    base.linkedVia = "invite";
    base.linkSource = "invitation";
    deps.continuity.put(base);
    routeIntent(egress, "invite", inbound.opaqueId);
    return { branch: "invite", opaqueId: inbound.opaqueId, link: base, routedIntent: "invite", accountBound: false };
  }

  // Branch 4 — cold inbound: anonymous open_chat link with provenance.
  base.linkedVia = "open_chat";
  base.linkSource = asLinkSource(inbound.bizGroupId, "cold");
  deps.continuity.put(base);
  routeIntent(egress, "open_chat", inbound.opaqueId);
  return { branch: "cold", opaqueId: inbound.opaqueId, link: base, routedIntent: "open_chat", accountBound: false };
}
