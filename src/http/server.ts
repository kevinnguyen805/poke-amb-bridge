import { createServer as nodeCreateServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleShare, handleIngress, type CoreDeps, type Headers } from "./core";

export type ServerDeps = CoreDeps;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

function toHeaders(req: IncomingMessage): Headers {
  const h: Headers = {};
  for (const [k, v] of Object.entries(req.headers)) h[k] = Array.isArray(v) ? v[0] : v;
  return h;
}

function send(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(json));
}

/** Long-running node:http transport for local dev (`npm run serve`). Delegates to the shared core. */
export function createBridgeServer(deps: ServerDeps): Server {
  return nodeCreateServer(async (req, res) => {
    try {
      const url = req.url ?? "/";
      if (req.method === "GET" && url === "/healthz") return send(res, 200, { ok: true });

      if (req.method === "POST" && url === "/share") {
        const r = await handleShare(deps, toHeaders(req), await readBody(req));
        return send(res, r.status, r.json);
      }
      if (req.method === "POST" && url === "/amb/ingress") {
        const r = await handleIngress(deps, toHeaders(req), await readBody(req));
        return send(res, r.status, r.json);
      }
      return send(res, 404, { error: "not found" });
    } catch {
      return send(res, 500, { error: "internal" });
    }
  });
}
