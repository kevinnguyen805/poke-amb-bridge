import { describe, it, expect } from "vitest";
import { mint, MintError, type MintDeps } from "../src/spine/mint";
import { InMemoryTokenStore } from "../src/spine/store";
import type { Clock } from "../src/spine/types";

const UUID = "00000000-1111-2222-3333-444444444444";
const fixedClock: Clock = { now: () => new Date("2026-06-05T18:00:00.000Z") };

function deps(tokens = new InMemoryTokenStore()): MintDeps {
  return { tokens, businessUuid: UUID, clock: fixedClock, newToken: () => "a".repeat(22) };
}

describe("mint (/share)", () => {
  it("scoped-key (Shortcut) caller mints an ANONYMOUS token (ttl 900), never an account", () => {
    const tokens = new InMemoryTokenStore();
    const r = mint(deps(tokens), { kind: "scoped-key" }, { payload: { kind: "url", url: "https://x.com" } });
    expect(r.tokenClass).toBe("anonymous");
    expect(r.ttl).toBe(900);
    expect(r.expiresAt).toBe("2026-06-05T18:15:00.000Z");
    const rec = tokens.get(r.token)!;
    expect(rec.pokeAccountIdRef).toBeUndefined();
    expect(rec.consentRef).toBeUndefined();
    expect("handle" in rec).toBe(false);
  });

  it("returns a convenience bcrwUrl with biz-intent-id and percent-encoded body", () => {
    const r = mint(deps(), { kind: "scoped-key" }, { intent: "share", payload: { kind: "url", url: "https://x.com" } });
    expect(r.bcrwUrl).toBe(
      `https://bcrw.apple.com/urn:biz:${UUID}?biz-intent-id=share&body=poke%3A${"a".repeat(22)}`,
    );
  });

  it("session caller WITH bind + valid consent mints an ACCOUNT-BOUND token (ttl 120), stamping the account from the session", () => {
    const tokens = new InMemoryTokenStore();
    const r = mint(
      deps(tokens),
      { kind: "session", pokeAccountId: "acct_42" },
      { bind: true, consentRef: "consent_abc", payload: { kind: "text", text: "hi" }, linkSource: "imessage_cta" },
    );
    expect(r.tokenClass).toBe("account-bound");
    expect(r.ttl).toBe(120);
    const rec = tokens.get(r.token)!;
    expect(rec.pokeAccountIdRef).toBe("acct_42");
    expect(rec.consentRef).toBe("consent_abc");
    expect(rec.linkSource).toBe("imessage_cta");
  });

  it("rejects an account-bound mint without a valid consentRef (403)", () => {
    try {
      mint(deps(), { kind: "session", pokeAccountId: "acct_42" }, { bind: true, payload: { kind: "text", text: "hi" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MintError);
      expect((e as MintError).status).toBe(403);
    }
  });

  it("a scoped-key caller can NEVER bind an account, even if it asks (403)", () => {
    expect(() =>
      mint(deps(), { kind: "scoped-key" }, { bind: true, consentRef: "consent_abc", payload: { kind: "text", text: "hi" } }),
    ).toThrow(MintError);
  });

  it("rejects a javascript: payload URL (400)", () => {
    try {
      mint(deps(), { kind: "scoped-key" }, { payload: { kind: "url", url: "javascript:alert(1)" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as MintError).status).toBe(400);
    }
  });

  it("rejects an oversized URL payload (400)", () => {
    expect(() =>
      mint(deps(), { kind: "scoped-key" }, { payload: { kind: "url", url: "https://x.com/" + "q".repeat(3000) } }),
    ).toThrow(MintError);
  });

  it("defaults intent to share and linkSource to shortcut for scoped-key", () => {
    const tokens = new InMemoryTokenStore();
    const r = mint(deps(tokens), { kind: "scoped-key" }, { payload: { kind: "url", url: "https://x.com" } });
    const rec = tokens.get(r.token)!;
    expect(rec.intent).toBe("share");
    expect(rec.linkSource).toBe("shortcut");
  });
});
