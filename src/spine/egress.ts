import type { AmbOutbound, Clock, LinkSource } from "./types";
import type { ContinuityStore } from "./store";
import type { Msp } from "./msp";

export type SendResult =
  | { sent: true }
  | { blocked: "out_of_window" | "budget" | "human_owns_turn"; fallback: string };

export type EgressDeps = {
  continuity: ContinuityStore;
  msp: Msp;
  clock: Clock;
  circuitBreaker?: { isOpen(linkSource: LinkSource): boolean };
};

function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / 3_600_000;
}

/**
 * The single mandatory outbound chokepoint (plan §"AMB egress middleware").
 * It is structurally impossible to emit an unlabeled or out-of-window AMB message.
 */
export async function sendAmb(deps: EgressDeps, opaqueId: string, msg: AmbOutbound): Promise<SendResult> {
  const link = await deps.continuity.get(opaqueId);

  // The agent stays silent while a human owns the turn (VL-5 real handoff).
  if (link?.agentState === "human" && msg.agentAuto === true) {
    return { blocked: "human_owns_turn", fallback: "none" };
  }

  // 1. Compliance stamp (VL-5) — every message, no exceptions.
  const stamped: AmbOutbound = { ...msg, aiLabeled: true, escalation: true, applePresentation: true };

  // 2. Hard 24h window (free-form sends only). alwaysReplyOnAMB CANNOT widen this.
  if (stamped.isFreeForm && link && hoursSince(link.lastInboundAt, deps.clock.now()) >= 24) {
    return { blocked: "out_of_window", fallback: "imessage_or_invitation" };
  }

  // 3. Per-linkSource circuit breaker (unit economics).
  if (link && deps.circuitBreaker?.isOpen(link.linkSource)) {
    return { blocked: "budget", fallback: "web_or_imessage" };
  }

  await deps.msp.send(opaqueId, stamped);
  return { sent: true };
}

/** Escalation routes to the MSP live-agent queue (a non-agent recipient) and flips turn state. */
export async function requestHumanHandoff(deps: EgressDeps, opaqueId: string): Promise<void> {
  const link = await deps.continuity.get(opaqueId);
  if (link) {
    link.agentState = "awaiting_human";
    await deps.continuity.put(link);
  }
  await deps.msp.routeToHuman(opaqueId);
}
