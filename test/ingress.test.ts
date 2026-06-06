import { describe, it, expect } from "vitest";
import { resolve, type ResolveDeps } from "../src/spine/ingress";
import { InMemoryTokenStore, InMemoryContinuityStore } from "../src/spine/store";
import { MockMsp } from "../src/spine/msp";
import type { AmbInbound, Clock, ShareTokenRecord } from "../src/spine/types";

const TOK = "a".repeat(22);
const NOW = new Date("2026-06-05T18:00:00.000Z");
const clock: Clock = { now: () => NOW };

function tokenRec(over: Partial<ShareTokenRecord> = {}): ShareTokenRecord {
  return {
    token: TOK,
    tokenClass: "anonymous",
    intent: "share",
    linkSource: "shortcut",
    payload: { kind: "url", url: "https://example.com/article" },
    createdAt: "2026-06-05T17:59:00.000Z",
    expiresAt: "2026-06-05T18:10:00.000Z", // future vs NOW
    ttl: 900,
    ...over,
  };
}

function inbound(over: Partial<AmbInbound> = {}): AmbInbound {
  return { opaqueId: "opaqueA", body: `poke:${TOK}`, receivedAt: NOW.toISOString(), ...over };
}

function setup(seed?: ShareTokenRecord) {
  const tokens = new InMemoryTokenStore();
  const continuity = new InMemoryContinuityStore();
  const msp = new MockMsp();
  if (seed) tokens.put(seed);
  const deps: ResolveDeps = { tokens, continuity, msp, clock };
  return { tokens, continuity, msp, deps };
}

describe("resolve (AMB ingress)", () => {
  it("branch 2d: a valid unconsumed ANONYMOUS token links the opaqueId, consumes the token, routes share — no account bound", () => {
    const { tokens, continuity, msp, deps } = setup(tokenRec());
    const out = resolve(deps, inbound());
    expect(out.branch).toBe("bound");
    expect(out.accountBound).toBe(false);
    expect(out.routedIntent).toBe("share");
    const link = continuity.get("opaqueA")!;
    expect(link.linkedVia).toBe("share");
    expect(link.linkSource).toBe("shortcut");
    expect(link.pokeAccountId).toBeUndefined();
    expect(tokens.get(TOK)?.consumedBy).toBe("opaqueA");
    expect(msp.sent[0]!.msg.aiLabeled).toBe(true); // reply went through sendAmb
  });

  it("branch 2d: an ACCOUNT-BOUND token with valid consent binds the account", () => {
    const { continuity, deps } = setup(
      tokenRec({ tokenClass: "account-bound", pokeAccountIdRef: "acct_42", consentRef: "c1" }),
    );
    const out = resolve(deps, inbound());
    expect(out.accountBound).toBe(true);
    const link = continuity.get("opaqueA")!;
    expect(link.pokeAccountId).toBe("acct_42");
    expect(link.consentRef).toBe("c1");
    expect(link.consentAt).toBe(NOW.toISOString());
  });

  it("branch 2c: replay by the SAME opaqueId does not re-process or double-reply", () => {
    const { msp, deps } = setup(tokenRec());
    resolve(deps, inbound());
    const out2 = resolve(deps, inbound());
    expect(out2.branch).toBe("replay");
    expect(msp.sent).toHaveLength(1); // no second reply
  });

  it("branch 2b: a consumed token presented by a DIFFERENT opaqueId is rejected — no bind, no merge", () => {
    const { tokens, continuity, deps } = setup(tokenRec());
    resolve(deps, inbound({ opaqueId: "opaqueA" }));
    const out = resolve(deps, inbound({ opaqueId: "opaqueB" }));
    expect(out.branch).toBe("foreign-reject");
    expect(out.accountBound).toBe(false);
    expect(continuity.get("opaqueB")?.pokeAccountId).toBeUndefined();
    expect(tokens.get(TOK)?.consumedBy).toBe("opaqueA"); // unchanged
  });

  it("concurrent-ish: first opaqueId binds, second is foreign-rejected", () => {
    const { deps } = setup(tokenRec());
    expect(resolve(deps, inbound({ opaqueId: "opaqueA" })).branch).toBe("bound");
    expect(resolve(deps, inbound({ opaqueId: "opaqueB" })).branch).toBe("foreign-reject");
  });

  it("branch 2a: an expired token still creates an anonymous link + a degraded labeled reply, never an error or a bind", () => {
    const { tokens, continuity, msp, deps } = setup(tokenRec({ expiresAt: "2026-06-05T17:55:00.000Z" }));
    const out = resolve(deps, inbound());
    expect(out.branch).toBe("expired");
    expect(continuity.get("opaqueA")?.pokeAccountId).toBeUndefined();
    expect(tokens.get(TOK)?.consumedAt).toBeUndefined(); // expired tokens are not consumed
    expect(msp.sent[0]!.msg.aiLabeled).toBe(true);
  });

  it("branch 2a: a token-shaped body with no matching record is treated as expired/missing, not an error", () => {
    const { deps } = setup(); // no seed
    expect(resolve(deps, inbound()).branch).toBe("expired");
  });

  it("branch 4: a cold inbound (no token) creates an anonymous open_chat link and greets", () => {
    const { continuity, msp, deps } = setup();
    const out = resolve(deps, inbound({ body: "hey what can you do" }));
    expect(out.branch).toBe("cold");
    expect(continuity.get("opaqueA")?.linkedVia).toBe("open_chat");
    expect(continuity.get("opaqueA")?.linkSource).toBe("cold");
    expect(msp.sent[0]!.msg.aiLabeled).toBe(true);
  });

  it("branch 4: cold inbound carries linkSource provenance from bizGroupId so it isn't mislabeled cold", () => {
    const { continuity, deps } = setup();
    resolve(deps, inbound({ body: "hi", bizGroupId: "qr" }));
    expect(continuity.get("opaqueA")?.linkSource).toBe("qr");
  });

  it("branch 3: an Invitation acceptance (no token, bizIntentId=invite) routes handleInvite with linkSource invitation", () => {
    const { continuity, msp, deps } = setup();
    const out = resolve(deps, inbound({ body: "", bizIntentId: "invite" }));
    expect(out.branch).toBe("invite");
    expect(out.routedIntent).toBe("invite");
    expect(continuity.get("opaqueA")?.linkSource).toBe("invitation");
    expect(msp.sent[0]!.msg.aiLabeled).toBe(true);
  });
});
