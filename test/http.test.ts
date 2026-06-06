import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { createBridgeServer, type ServerDeps } from "../src/http/server";
import { InMemoryTokenStore, InMemoryContinuityStore } from "../src/spine/store";
import { MockMsp } from "../src/spine/msp";
import type { Clock } from "../src/spine/types";

const UUID = "00000000-1111-2222-3333-444444444444";
const clock: Clock = { now: () => new Date("2026-06-05T18:00:00.000Z") };
const SCOPED_KEY = "pk_shortcut_demo";
const MSP_SECRET = "msp_secret_demo";

function build() {
  const tokens = new InMemoryTokenStore();
  const continuity = new InMemoryContinuityStore();
  const msp = new MockMsp();
  const deps: ServerDeps = {
    tokens,
    continuity,
    msp,
    clock,
    businessUuid: UUID,
    scopedKey: SCOPED_KEY,
    mspSecret: MSP_SECRET,
  };
  return { server: createBridgeServer(deps), tokens, continuity, msp };
}

function listen(server: Server): Promise<string> {
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      res(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
    });
  });
}

function sign(body: string): string {
  return createHmac("sha256", MSP_SECRET).update(body).digest("hex");
}

async function withServer<T>(fn: (base: string, ctx: ReturnType<typeof build>) => Promise<T>): Promise<T> {
  const ctx = build();
  const base = await listen(ctx.server);
  try {
    return await fn(base, ctx);
  } finally {
    await new Promise<void>((r) => ctx.server.close(() => r()));
  }
}

describe("bridge HTTP server", () => {
  it("GET /healthz returns 200", async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/healthz`);
      expect(r.status).toBe(200);
    });
  });

  it("POST /share with the scoped key mints an anonymous token (201)", async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-poke-key": SCOPED_KEY },
        body: JSON.stringify({ payload: { kind: "url", url: "https://example.com/a" } }),
      });
      expect(r.status).toBe(201);
      const j = (await r.json()) as { tokenClass: string; bcrwUrl: string };
      expect(j.tokenClass).toBe("anonymous");
      expect(j.bcrwUrl).toContain("body=poke%3A");
    });
  });

  it("POST /share without auth is rejected (401)", async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { kind: "url", url: "https://example.com/a" } }),
      });
      expect(r.status).toBe(401);
    });
  });

  it("POST /share maps a MintError to its status (javascript: payload → 400)", async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-poke-key": SCOPED_KEY },
        body: JSON.stringify({ payload: { kind: "url", url: "javascript:alert(1)" } }),
      });
      expect(r.status).toBe(400);
    });
  });

  it("POST /amb/ingress without a valid HMAC signature is rejected (401)", async () => {
    await withServer(async (base) => {
      const body = JSON.stringify({ opaqueId: "x", body: "hi", receivedAt: clock.now().toISOString() });
      const r = await fetch(`${base}/amb/ingress`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-msp-signature": "deadbeef" },
        body,
      });
      expect(r.status).toBe(401);
    });
  });

  it("full loop: POST /share → POST /amb/ingress links the user and emits a labeled reply", async () => {
    await withServer(async (base, ctx) => {
      // 1. mint
      const mintRes = await fetch(`${base}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-poke-key": SCOPED_KEY },
        body: JSON.stringify({ payload: { kind: "url", url: "https://example.com/article" } }),
      });
      const { token } = (await mintRes.json()) as { token: string };

      // 2. user taps Send → MSP delivers the first inbound (HMAC-signed)
      const inbound = JSON.stringify({
        opaqueId: "urrn_user_1",
        body: `poke:${token}`,
        receivedAt: clock.now().toISOString(),
      });
      const ingressRes = await fetch(`${base}/amb/ingress`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-msp-signature": sign(inbound) },
        body: inbound,
      });

      expect(ingressRes.status).toBe(200);
      const out = (await ingressRes.json()) as { branch: string; accountBound: boolean };
      expect(out.branch).toBe("bound");
      expect(out.accountBound).toBe(false);
      expect(ctx.continuity.get("urrn_user_1")).toBeDefined();
      expect(ctx.msp.sent[0]!.msg.aiLabeled).toBe(true);
    });
  });
});
