import type { AmbOutbound } from "./types";

/**
 * The Apple-approved Messaging Service Provider boundary (ASSUMPTION-A2).
 * Methods return `void | Promise<void>` so the mock stays synchronous while a real
 * HTTP-backed adapter is async. `routeToHuman` = handoff to the MSP live-agent queue.
 */
export interface Msp {
  send(opaqueId: string, msg: AmbOutbound): void | Promise<void>;
  routeToHuman(opaqueId: string): void | Promise<void>;
}

/** Records what would have been sent — a reference mock for the MSP boundary (tests/local). */
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

/**
 * Logs what would be sent — for the DEPLOYED service before a real MSP is wired.
 * In-memory recording is useless across stateless invocations, so we emit to the platform log.
 * Replace with a real MSP REST adapter once credentials exist (see PRODUCTION.md).
 */
export class LoggingMsp implements Msp {
  send(opaqueId: string, msg: AmbOutbound): void {
    console.log("[amb:send]", opaqueId, JSON.stringify(msg));
  }

  routeToHuman(opaqueId: string): void {
    console.log("[amb:human-handoff]", opaqueId);
  }
}
