import { describe, it, expect } from "vitest";
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
