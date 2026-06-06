import { describe, it, expect } from "vitest";
import { sendAmb, requestHumanHandoff, type EgressDeps } from "../src/spine/egress";
import { InMemoryContinuityStore } from "../src/spine/store";
import { MockMsp } from "../src/spine/msp";
import type { Clock, ContinuityLink } from "../src/spine/types";

const NOW = new Date("2026-06-05T18:00:00.000Z");
const clock: Clock = { now: () => NOW };

function setup(linkOverrides: Partial<ContinuityLink> = {}) {
  const continuity = new InMemoryContinuityStore();
  const msp = new MockMsp();
  const link: ContinuityLink = {
    opaqueId: "opaqueA",
    agentState: "agent",
    firstLinkedAt: "2026-06-05T17:00:00.000Z",
    lastSeenAt: "2026-06-05T17:59:00.000Z",
    lastInboundAt: "2026-06-05T17:59:00.000Z", // 1 min ago — inside the window
    linkedVia: "share",
    linkSource: "shortcut",
    ...linkOverrides,
  };
  continuity.put(link);
  const deps: EgressDeps = { continuity, msp, clock };
  return { continuity, msp, deps };
}

describe("sendAmb (AMB egress middleware)", () => {
  it("stamps AI-label, human escalation, and Apple presentation on EVERY outbound", () => {
    const { msp, deps } = setup();
    const r = sendAmb(deps, "opaqueA", { text: "hi", isFreeForm: true });
    expect(r).toEqual({ sent: true });
    const sent = msp.sent[0]!.msg;
    expect(sent.aiLabeled).toBe(true);
    expect(sent.escalation).toBe(true);
    expect(sent.applePresentation).toBe(true);
  });

  it("hard-blocks a free-form send past the 24h window; alwaysReplyOnAMB cannot override", () => {
    const { msp, deps } = setup({
      lastInboundAt: "2026-06-04T17:00:00.000Z", // 25h ago
      alwaysReplyOnAMB: true,
    });
    const r = sendAmb(deps, "opaqueA", { text: "ping", isFreeForm: true });
    expect(r).toEqual({ blocked: "out_of_window", fallback: "imessage_or_invitation" });
    expect(msp.sent).toHaveLength(0);
  });

  it("allows a non-free-form session reply even past 24h (List Picker/Form exemption)", () => {
    const { deps } = setup({ lastInboundAt: "2026-06-04T17:00:00.000Z" });
    expect(sendAmb(deps, "opaqueA", { text: "picker", isFreeForm: false })).toEqual({ sent: true });
  });

  it("degrades an over-budget linkSource instead of opening a billable turn", () => {
    const { msp, deps } = setup();
    deps.circuitBreaker = { isOpen: (ls) => ls === "shortcut" };
    const r = sendAmb(deps, "opaqueA", { text: "hi", isFreeForm: true });
    expect(r).toEqual({ blocked: "budget", fallback: "web_or_imessage" });
    expect(msp.sent).toHaveLength(0);
  });

  it("suppresses an automated agent reply while a human owns the turn", () => {
    const { msp, deps } = setup({ agentState: "human" });
    const r = sendAmb(deps, "opaqueA", { text: "auto", isFreeForm: true, agentAuto: true });
    expect(r).toEqual({ blocked: "human_owns_turn", fallback: "none" });
    expect(msp.sent).toHaveLength(0);
  });

  it("requestHumanHandoff routes to the MSP human queue (a non-agent recipient) and flips agentState", () => {
    const { continuity, msp, deps } = setup();
    requestHumanHandoff(deps, "opaqueA");
    expect(msp.humanRouted).toContain("opaqueA");
    expect(continuity.get("opaqueA")?.agentState).toBe("awaiting_human");
  });
});
