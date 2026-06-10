import { describe, it, expect, afterEach } from "vitest";
import handler from "../api/mcp";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("mcp initialize", () => {
  it("returns server info and behavioral instructions for onboarding", async () => {
    const res = await handler(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    );
    const json: any = await res.json();
    expect(json.result.serverInfo.name).toBe("poke-link-companion");
    // The MCP `instructions` field is where onboarding behavior lives so Poke
    // introduces the abilities and does NOT auto-act on shared links.
    expect(typeof json.result.instructions).toBe("string");
    const instr = json.result.instructions.toLowerCase();
    expect(instr).toContain("save");
    expect(instr).toContain("do not");
    // The shortcut URL is folded into instructions so the recipe can hand it out
    // without depending on the get_share_shortcut tool call being delivered.
    expect(instr).toContain("icloud.com/shortcuts/");
  });
});

describe("mcp tools/list", () => {
  it("lists the four link tools", async () => {
    const res = await handler(post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const json: any = await res.json();
    const names = json.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["fetch_link", "get_share_shortcut", "list_links", "save_link"]);
  });
});

describe("mcp tools/call get_share_shortcut", () => {
  it("returns the Message Poke shortcut link without needing a database", async () => {
    const res = await handler(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_share_shortcut", arguments: {} } }),
    );
    const json: any = await res.json();
    expect(json.result.content[0].text).toContain("icloud.com/shortcuts/");
  });
});

// Streamable HTTP transport: MCP clients (Poke) send `Accept: text/event-stream`
// and expect the JSON-RPC result framed as a Server-Sent Event, not plain JSON.
describe("mcp streamable-http transport", () => {
  it("frames the response as SSE when the client accepts text/event-stream", async () => {
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_share_shortcut", arguments: {} } },
        { accept: "application/json, text/event-stream" },
      ),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: message");
    const dataLine = body.split("\n").find((l) => l.startsWith("data:"));
    expect(dataLine).toBeTruthy();
    const payload = JSON.parse(dataLine!.replace(/^data:\s*/, ""));
    expect(payload.result.content[0].text).toContain("icloud.com/shortcuts/");
  });

  it("falls back to plain JSON when the client does not accept event-stream", async () => {
    const res = await handler(
      post({ jsonrpc: "2.0", id: 8, method: "tools/list", params: {} }, { accept: "application/json" }),
    );
    expect(res.headers.get("content-type")).toContain("application/json");
    const json: any = await res.json();
    expect(json.result.tools.length).toBe(4);
  });

  it("answers a GET SSE-stream open with 405 (no server-initiated stream)", async () => {
    const res = await handler(
      new Request("https://x/mcp", { method: "GET", headers: { accept: "text/event-stream" } }),
    );
    expect(res.status).toBe(405);
  });
});

// Tier-1 auth: data tools (save/list/fetch) require a credential when MCP_AUTH_ENFORCE=true
// (Authorization: Bearer <key> OR x-poke-key); get_share_shortcut + discovery stay open. With the
// flag unset it's diagnostic-only — logs but never rejects. POKE_SCOPED_KEY is unset in tests, so
// the accepted key is the "pk_shortcut_demo" default.
describe("mcp data-tool auth gate", () => {
  afterEach(() => {
    delete process.env.MCP_AUTH_ENFORCE;
  });

  it("diagnostic mode (default): does NOT reject a data tool sent with no credential", async () => {
    const res = await handler(
      post({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "list_links", arguments: {} } }),
    );
    const json: any = await res.json();
    expect(json.error?.code).not.toBe(-32001);
  });

  it("enforce mode: rejects list_links with no credential (-32001)", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "list_links", arguments: {} } }),
    );
    const json: any = await res.json();
    expect(json.error?.code).toBe(-32001);
  });

  it("enforce mode: accepts a valid Authorization: Bearer <key>", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "list_links", arguments: {} } },
        { authorization: "Bearer pk_shortcut_demo" },
      ),
    );
    const json: any = await res.json();
    expect(json.error?.code).not.toBe(-32001);
  });

  it("enforce mode: accepts a valid x-poke-key", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "save_link", arguments: { url: "https://x.com" } } },
        { "x-poke-key": "pk_shortcut_demo" },
      ),
    );
    const json: any = await res.json();
    expect(json.error?.code).not.toBe(-32001);
  });

  it("enforce mode: leaves get_share_shortcut open (no credential needed)", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "get_share_shortcut", arguments: {} } }),
    );
    const json: any = await res.json();
    expect(json.error).toBeUndefined();
    expect(json.result.content[0].text).toContain("icloud.com/shortcuts/");
  });
});
