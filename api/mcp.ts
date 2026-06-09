import { saveLink, listLinks } from "../src/links/store";
import { fetchReadable } from "../src/links/fetch";

// MCP server implemented as a plain Streamable-HTTP JSON-RPC endpoint (edge Web handler).
// No SDK — the Node-only MCP SDK can't run on this project's edge runtime.
export const config = { runtime: "edge" };

const SHORTCUT_URL = "https://www.icloud.com/shortcuts/38066270bde04dd5bb6da2b144111f61";
const SHORTCUT_INFO =
  `Here's the "Message Poke" Shortcut — install it once to share links to Poke from any app:\n${SHORTCUT_URL}\n\n` +
  `After installing: in any app tap Share → "Message Poke" → a Poke chat opens with your link pre-filled → tap Send.`;

// MCP `instructions` — onboarding behavior Poke reads at connect time. This is the
// home for "introduce the abilities, don't auto-act"; tool descriptions only gate calls.
const INSTRUCTIONS =
  "Link Companion lets the user save, search, read, and share links — all inside this chat. " +
  "When the user first interacts (or shares their first link), briefly introduce what you can do with a link: " +
  "(1) save it to their personal list, (2) find saved links later by keyword, (3) read/summarize a page for them, " +
  "and (4) hand them the iOS \"Message Poke\" Shortcut to share links from any app. Then wait for them to choose. " +
  "Do NOT act on a shared link automatically: only call save_link when they ask to save/bookmark, only call list_links " +
  "when they ask to see saved links, only call fetch_link when they ask about a page's contents, and only call " +
  "get_share_shortcut when they ask how to send you links from other apps.";

const TOOLS = [
  {
    name: "get_share_shortcut",
    description:
      "Return the iOS 'Message Poke' Shortcut install link and setup steps so the user can share links to Poke from any app's Share Sheet. Call when the user asks how to share links with you or wants the shortcut.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "save_link",
    description: "Save a link to the user's personal list. Only call when the user explicitly asks to save/bookmark a link.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "the URL to save" },
        note: { type: "string", description: "optional note" },
        tags: { type: "array", items: { type: "string" }, description: "optional tags" },
      },
      required: ["url"],
    },
  },
  {
    name: "list_links",
    description: "List the user's saved links, optionally filtered by a search query. Only call when the user asks to see their saved links.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
    },
  },
  {
    name: "fetch_link",
    description:
      "Fetch the readable text of a web page so you can summarize it or answer questions about it. Only call when the user asks about the page's contents.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
];

async function callTool(name: string, args: any, userId: string): Promise<string> {
  switch (name) {
    case "get_share_shortcut":
      return SHORTCUT_INFO;
    case "save_link": {
      const l = await saveLink(userId, args.url, args.note, args.tags);
      return `Saved: ${l.url}${l.note ? ` — ${l.note}` : ""}`;
    }
    case "list_links": {
      const links = await listLinks(userId, args.query, args.limit ?? 20);
      return links.length
        ? links.map((l) => `• ${l.url}${l.note ? ` — ${l.note}` : ""}${l.tags ? ` [${l.tags.join(", ")}]` : ""}`).join("\n")
        : "No saved links yet.";
    }
    case "fetch_link":
      return await fetchReadable(args.url);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// MCP Streamable HTTP: clients (Poke) send `Accept: text/event-stream` and expect the
// JSON-RPC result delivered as a single Server-Sent Event — a plain application/json body
// reads to them as an unparseable failure. Negotiate on Accept; keep JSON for simple clients.
function wantsSse(req: Request): boolean {
  return (req.headers.get("accept") ?? "").includes("text/event-stream");
}
function rpc(req: Request, payload: unknown): Response {
  if (!wantsSse(req)) return json(payload);
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}
const ok = (req: Request, id: unknown, result: unknown) => rpc(req, { jsonrpc: "2.0", id, result });
const err = (req: Request, id: unknown, code: number, message: string) =>
  rpc(req, { jsonrpc: "2.0", id, error: { code, message } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    // MCP clients open a GET SSE stream for server-initiated messages; we push none → 405.
    if (wantsSse(req)) return new Response("No server-initiated stream", { status: 405 });
    return json({ name: "poke-link-companion", version: "0.1.0", status: "ok" });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const userId = req.headers.get("x-poke-user-id") ?? "anonymous";
  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return err(req, null, -32700, "Parse error");
  }
  const { id = null, method, params } = msg ?? {};

  try {
    switch (method) {
      case "initialize":
        return ok(req, id, {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "poke-link-companion", version: "0.1.0" },
          instructions: INSTRUCTIONS,
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return new Response(null, { status: 202 });
      case "ping":
        return ok(req, id, {});
      case "tools/list":
        return ok(req, id, { tools: TOOLS });
      case "tools/call": {
        const text = await callTool(params?.name, params?.arguments ?? {}, userId);
        return ok(req, id, { content: [{ type: "text", text }] });
      }
      default:
        return err(req, id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return err(req, id, -32603, String((e as Error)?.message ?? e));
  }
}
