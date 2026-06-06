import { describe, it, expect } from "vitest";
import { mint } from "../src/spine/mint";
import { resolve } from "../src/spine/ingress";
import { InMemoryTokenStore, InMemoryContinuityStore } from "../src/spine/store";
import { MockMsp } from "../src/spine/msp";
import type { Clock } from "../src/spine/types";

// End-to-end acceptance tests over the already-unit-tested spine modules.
const UUID = "00000000-1111-2222-3333-444444444444";
const clock: Clock = { now: () => new Date("2026-06-05T18:00:00.000Z") };

function world() {
  return { tokens: new InMemoryTokenStore(), continuity: new InMemoryContinuityStore(), msp: new MockMsp() };
}

function bodyFromBcrw(bcrwUrl: string): string {
  return decodeURIComponent(bcrwUrl.split("body=")[1]!);
}

describe("E2E spine", () => {
  it("Flow 1 — Share-to-Poke: shared URL → linked, labeled AMB reply, NO account bound, NO raw handle stored", async () => {
    const w = world();
    const minted = await mint(
      { tokens: w.tokens, businessUuid: UUID, clock },
      { kind: "scoped-key" },
      { payload: { kind: "url", url: "https://example.com/article" } },
    );
    expect(minted.tokenClass).toBe("anonymous");

    const out = await resolve(
      { tokens: w.tokens, continuity: w.continuity, msp: w.msp, clock },
      { opaqueId: "urrn_user_1", body: bodyFromBcrw(minted.bcrwUrl), receivedAt: clock.now().toISOString() },
    );

    expect(out.branch).toBe("bound");
    expect(out.accountBound).toBe(false);
    expect((await w.continuity.get("urrn_user_1"))?.pokeAccountId).toBeUndefined();
    expect(w.msp.sent.every((s) => s.msg.aiLabeled && s.msg.escalation && s.msg.applePresentation)).toBe(true);
    expect("handle" in (await w.tokens.get(minted.token))!).toBe(false);
  });

  it("Flow (consented binding) — a session + consent token binds the Poke account across the first AMB message", async () => {
    const w = world();
    const minted = await mint(
      { tokens: w.tokens, businessUuid: UUID, clock },
      { kind: "session", pokeAccountId: "acct_99" },
      { bind: true, consentRef: "consent_logged", payload: { kind: "text", text: "link me" }, linkSource: "imessage_cta" },
    );
    expect(minted.tokenClass).toBe("account-bound");

    const out = await resolve(
      { tokens: w.tokens, continuity: w.continuity, msp: w.msp, clock },
      { opaqueId: "urrn_user_2", body: bodyFromBcrw(minted.bcrwUrl), receivedAt: clock.now().toISOString() },
    );

    expect(out.accountBound).toBe(true);
    expect((await w.continuity.get("urrn_user_2"))?.pokeAccountId).toBe("acct_99");
    expect((await w.continuity.get("urrn_user_2"))?.consentRef).toBe("consent_logged");
  });

  it("Single-use end to end: the same shared link presented by a SECOND opaque ID is rejected (no takeover)", async () => {
    const w = world();
    const minted = await mint(
      { tokens: w.tokens, businessUuid: UUID, clock },
      { kind: "scoped-key" },
      { payload: { kind: "url", url: "https://example.com/a" } },
    );
    const body = bodyFromBcrw(minted.bcrwUrl);
    const deps = { tokens: w.tokens, continuity: w.continuity, msp: w.msp, clock };

    expect((await resolve(deps, { opaqueId: "urrn_owner", body, receivedAt: clock.now().toISOString() })).branch).toBe("bound");
    expect((await resolve(deps, { opaqueId: "urrn_attacker", body, receivedAt: clock.now().toISOString() })).branch).toBe(
      "foreign-reject",
    );
    expect((await w.continuity.get("urrn_attacker"))?.pokeAccountId).toBeUndefined();
  });
});
