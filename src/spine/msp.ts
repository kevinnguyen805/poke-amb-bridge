import type { AmbOutbound } from "./types";

/**
 * The Apple-approved Messaging Service Provider boundary (ASSUMPTION-A2).
 * In production this is the MSP's AMB REST API / SDK; here it is mocked so the spine is
 * fully testable. `routeToHuman` represents handoff to the MSP's live-agent queue.
 */
export interface Msp {
  send(opaqueId: string, msg: AmbOutbound): void;
  routeToHuman(opaqueId: string): void;
}

/** Records what would have been sent — a reference mock for the MSP boundary. */
export class MockMsp implements Msp {
  sent: { opaqueId: string; msg: AmbOutbound }[] = [];
  humanRouted: string[] = [];

  send(opaqueId: string, msg: AmbOutbound): void {
    this.sent.push({ opaqueId, msg: { ...msg } });
  }

  routeToHuman(opaqueId: string): void {
    this.humanRouted.push(opaqueId);
  }
}
