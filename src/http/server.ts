import { createServer as nodeCreateServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mint, MintError, type Principal } from "../spine/mint";
import { resolve } from "../spine/ingress";
import type { InMemoryTokenStore, InMemoryContinuityStore } from "../spine/store";
import type { Msp } from "../spine/msp";
import type { AmbInbound, Clock } from "../spine/types";

export type ServerDeps = {
  tokens: InMemoryTokenStore;
  continuity: InMemoryContinuityStore;
  msp: Msp;
  clock: Clock;
  businessUuid: string;
  scopedKey: string; // the Shortcut's public scoped key (anonymous-mint-only)
  mspSecret: string; // HMAC key the MSP signs inbound webhooks with
  sessionResolver?: (bearer: string) => { pokeAccountId: string } | undefined;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

function json(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function defaultSessionResolver(bearer: string): { pokeAccountId: string } | undefined {
  return bearer.startsWith("session_") ? { pokeAccountId: bearer.slice("session_".length) } : undefined;
}

function principalFrom(req: IncomingMessage, deps: ServerDeps): Principal | undefined {
  const key = req.headers["x-poke-key"];
  if (typeof key === "string" && safeEq(key, deps.scopedKey)) return { kind: "scoped-key" };
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const s = (deps.sessionResolver ?? defaultSessionResolver)(auth.slice(7));
    if (s) return { kind: "session", pokeAccountId: s.pokeAccountId };
  }
  return undefined;
}

function verifyHmac(raw: string, sig: string | string[] | undefined, secret: string): boolean {
  if (typeof sig !== "string") return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return safeEq(sig, expected);
}

/** Thin HTTP transport over the spine. The two routes are the surfaces the real flow hits. */
export function createBridgeServer(deps: ServerDeps): Server {
  return nodeCreateServer(async (req, res) => {
    try {
      const url = req.url ?? "/";

      if (req.method === "GET" && url === "/healthz") return json(res, 200, { ok: true });

      // The Shortcut / web calls this. The credential class determines the token class.
      if (req.method === "POST" && url === "/share") {
        const principal = principalFrom(req, deps);
        if (!principal) return json(res, 401, { error: "unauthorized" });
        let body: { payload?: unknown };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: "invalid json" });
        }
        if (!body || typeof body !== "object" || !body.payload) return json(res, 400, { error: "payload required" });
        try {
          const result = mint({ tokens: deps.tokens, businessUuid: deps.businessUuid, clock: deps.clock }, principal, body as never);
          return json(res, 201, result);
        } catch (e) {
          if (e instanceof MintError) return json(res, e.status, { error: e.message });
          throw e;
        }
      }

      // The MSP webhook calls this on every inbound. HMAC-signed; reject otherwise.
      if (req.method === "POST" && url === "/amb/ingress") {
        const raw = await readBody(req);
        if (!verifyHmac(raw, req.headers["x-msp-signature"], deps.mspSecret)) {
          return json(res, 401, { error: "bad signature" });
        }
        let inbound: AmbInbound;
        try {
          inbound = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: "invalid json" });
        }
        const out = resolve(
          { tokens: deps.tokens, continuity: deps.continuity, msp: deps.msp, clock: deps.clock },
          inbound,
        );
        return json(res, 200, { branch: out.branch, accountBound: out.accountBound, routedIntent: out.routedIntent });
      }

      return json(res, 404, { error: "not found" });
    } catch {
      return json(res, 500, { error: "internal" });
    }
  });
}
