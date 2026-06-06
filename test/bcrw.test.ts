import { describe, it, expect } from "vitest";
import { buildBcrwUrl, buildBcrwOpenChatUrl, buildSmsOpenFallback } from "../src/spine/bcrw";

const UUID = "00000000-1111-2222-3333-444444444444";

describe("bcrw URL builder", () => {
  it("builds the canonical tokenized share URL with a percent-encoded body", () => {
    const t = "a8K2pQ7mZ4xR1nB6vT0wYc";
    expect(buildBcrwUrl(UUID, "share", t)).toBe(
      `https://bcrw.apple.com/urn:biz:${UUID}?biz-intent-id=share&body=poke%3A${t}`,
    );
  });

  it("encodes the colon as %3A and never emits a raw poke: body (VL-1: encode, never strip)", () => {
    const url = buildBcrwUrl(UUID, "signup", "a".repeat(22));
    expect(url).toContain("body=poke%3A");
    expect(url).not.toContain("body=poke:");
    expect(url).toContain("biz-intent-id=signup");
  });

  it("builds a tokenless open_chat URL with body omitted by design", () => {
    const url = buildBcrwOpenChatUrl(UUID);
    expect(url).toBe(`https://bcrw.apple.com/urn:biz:${UUID}?biz-intent-id=open_chat`);
    expect(url).not.toContain("body=");
  });

  it("rejects an invalid token rather than injecting unencoded junk", () => {
    expect(() => buildBcrwUrl(UUID, "share", "not a valid token!")).toThrow();
  });

  it("provides the documented sms:open plan-B fallback (LAUNCH GATE 0)", () => {
    expect(buildSmsOpenFallback(UUID)).toBe(
      `https://bcrw.apple.com/sms:open?service=iMessage&recipient=urn:biz:${UUID}`,
    );
  });
});
