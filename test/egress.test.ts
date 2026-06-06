import { describe, it, expect } from "vitest";
import { sendAmb, requestHumanHandoff, type EgressDeps } from "../src/spine/egress";
import { InMemoryContinuityStore } from "../src/spine/store";
import { MockMsp } from "../src/spine/msp";
import type { Clock, ContinuityLink } from "../src/spine/types";

const NOW = new Date("2026-06-05T18:00:00.000Z");
const clock: Clock = { now: () => NOW };

async function setup(linkOverrides: Partial<ContinuityLink> = {}) {
  const continuity = new InMemoryContinuityStore();
  const msp = new MockMsp();
  const link: ContinuityLink = {
    opaqueId: "opaqueA",
    agentState: "agent",
    firstLinkedAt: "2026-06-05T17:00:00.000Z",
    lastSeenAt: "2026-06-05T17:59:00.000Z",
    lastInboundAt: "2026-06-05T17:59:00.000Z",
    linkedVia: "share",
    linkSource: "shortcut",
    ...linkOverrides,
  };
  await continuity.put(link);
  const deps: EgressDeps = { continuity, msp, clock };
  return { continuity, msp, deps };
}

describe("sendAmb (AMB egress middleware)", () => {
  it("stamps AI-label, human escalation, and Apple presentation on EVERY outbound", async () => {
    const { msp, deps } = await setup();
    const r = await sendAmb(deps, "opaqueA", { text: "hi", isFreeForm: true });
    expect(r).toEqual({ sent: true });
    const sent = msp.sent[0]!.msg;
    expect(sent.aiLabeled).toBe(true);
    expect(sent.escalation).toBe(true);
    expect(sent.applePresentation).toBe(true);
  });

  it("hard-blocks a free-form send past the 24h window; alwaysReplyOnAMB cannot override", async () => {
    const { msp, deps } = await setup({ lastInboundAt: "2026-06-04T17:00:00.000Z", alwaysReplyOnAMB: true });
    const r = await sendAmb(deps, "opaqueA", { text: "ping", isFreeForm: true });
    expect(r).toEqual({ blocked: "out_of_window", fallback: "imessage_or_invitation" });
    expect(msp.sent).toHaveLength(0);
  });

  it("allows a non-free-form session reply even past 24h (List Picker/Form exemption)", async () => {
    const { deps } = await setup({ lastInboundAt: "2026-06-04T17:00:00.000Z" });
    expect(await sendAmb(deps, "opaqueA", { text: "picker", isFreeForm: false })).toEqual({ sent: true });
  });

  it("degrades an over-budget linkSource instead of opening a billable turn", async () => {
    const { msp, deps } = await setup();
    deps.circuitBreaker = { isOpen: (ls) => ls === "shortcut" };
    const r = await sendAmb(deps, "opaqueA", { text: "hi", isFreeForm: true });
    expect(r).toEqual({ blocked: "budget", fallback: "web_or_imessage" });
    expect(msp.sent).toHaveLength(0);
  });

  it("suppresses an automated agent reply while a human owns the turn", async () => {
    const { msp, deps } = await setup({ agentState: "human" });
    const r = await sendAmb(deps, "opaqueA", { text: "auto", isFreeForm: true, agentAuto: true });
    expect(r).toEqual({ blocked: "human_owns_turn", fallback: "none" });
    expect(msp.sent).toHaveLength(0);
  });

  it("requestHumanHandoff routes to the MSP human queue (a non-agent recipient) and flips agentState", async () => {
    const { continuity, msp, deps } = await setup();
    await requestHumanHandoff(deps, "opaqueA");
    expect(msp.humanRouted).toContain("opaqueA");
    expect((await continuity.get("opaqueA"))?.agentState).toBe("awaiting_human");
  });
});
