import { describe, it, expect, afterEach } from "vitest";
import handler from "../api/mcp";
import { verifyIngestToken } from "../src/links/ingestToken";

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

  it("carries USAGE GUIDANCE so Poke can explain what sharing does and what to ask", async () => {
    const res = await handler(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    );
    const json: any = await res.json();
    const instr: string = json.result.instructions;
    expect(instr).toContain("USAGE GUIDANCE");
    // The three pillars: what sharing does (silent save, no chat), what to save,
    // and concrete retrieval phrasings Poke should hand the user.
    expect(instr).toContain("saves it silently");
    expect(instr.toLowerCase()).toContain("articles to read later");
    expect(instr).toContain("what did I save this week?");
    // Tailoring path: chat saves carry notes/tags; shortcut saves arrive tagged.
    expect(instr).toContain("note/tags");
    expect(instr).toContain("tagged 'shortcut'");
    // Guardrail against Poke turning the quick-start into a nag.
    expect(instr.toLowerCase()).toContain("do not repeat it every time");
  });
});

describe("mcp tools/list", () => {
  it("lists the five tools", async () => {
    const res = await handler(post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const json: any = await res.json();
    const names = json.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["fetch_link", "get_share_shortcut", "list_links", "save_link", "setup_save_to_poke"]);
  });
});

describe("mcp tools/call setup_save_to_poke", () => {
  afterEach(() => {
    delete process.env.MCP_AUTH_ENFORCE;
  });

  it("mints a personal key bound to the auto-injected user id, with install steps — no auth or DB needed", async () => {
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "setup_save_to_poke", arguments: {} } },
        { "x-poke-user-id": "4c542392-0000-0000-0000-000000000000" },
      ),
    );
    const json: any = await res.json();
    const text: string = json.result.content[0].text;
    // The token is self-authenticating and verifies back to the caller's user id.
    const token = text.match(/spk_[A-Za-z0-9_-]+\.[0-9a-f]+/)?.[0];
    expect(token, `no spk_ token in tool result:\n${text}`).toBeTruthy();
    await expect(verifyIngestToken(process.env.POKE_SCOPED_KEY ?? "pk_shortcut_demo", token!)).resolves.toBe(
      "4c542392-0000-0000-0000-000000000000",
    );
    expect(text).toContain("/save-to-poke.shortcut");
    expect(text).toContain("/links/ingest");
    // The lead deliverable is the tappable setup link carrying the token — chat UIs
    // mangle raw keys (the failure Kevin hit live on poke.com).
    expect(text).toContain(`/setup?k=${token}`);
    // First-run guidance rides along verbatim: what sharing does, what to save,
    // and example asks — Poke relays this text as-is, so it must be self-contained.
    expect(text).toContain('"Saved ✓" banner');
    expect(text).toContain("articles to read later");
    expect(text).toContain("what did I save this week?");
    expect(text).toContain("tag travel");
  });

  it("stays OPEN when MCP_AUTH_ENFORCE is on — public installers arrive with no key", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "setup_save_to_poke", arguments: {} } },
        { "x-poke-user-id": "4c542392-0000-0000-0000-000000000000" },
      ),
    );
    const json: any = await res.json();
    expect(json.error).toBeUndefined();
    expect(json.result.content[0].text).toContain("spk_");
  });

  it("declines politely when no user id was injected (direct curl, not via Poke)", async () => {
    const res = await handler(
      post({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "setup_save_to_poke", arguments: {} } }),
    );
    const json: any = await res.json();
    expect(json.result.content[0].text).not.toContain("spk_");
    expect(json.result.content[0].text.toLowerCase()).toContain("poke");
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
    expect(json.result.tools.length).toBe(5);
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

  it("enforce mode: rejects list_links with no credential AND no user id (-32001)", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "list_links", arguments: {} } }),
    );
    const json: any = await res.json();
    expect(json.error?.code).toBe(-32001);
  });

  // Recipe installers are keyless forever (Poke's shared connections carry no API key);
  // a -32001 here wedges Poke into a needs-authorization loop that dead-ends in a
  // poke.com 500 (no OAuth on this server). The injected uid IS their credential.
  it("enforce mode: allows data tools when Poke injects a user id (keyless recipe installers)", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "list_links", arguments: {} } },
        { "x-poke-user-id": "5daab433-0000-0000-0000-000000000000" },
      ),
    );
    const json: any = await res.json();
    // No store in unit tests — the call may fail downstream (-32603), but it must
    // get PAST the auth gate (the -32001 is what wedges Poke's client).
    expect(json.error?.code).not.toBe(-32001);
  });

  it("enforce mode: an empty x-poke-user-id header does not count as a credential", async () => {
    process.env.MCP_AUTH_ENFORCE = "true";
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "list_links", arguments: {} } },
        { "x-poke-user-id": "" },
      ),
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
