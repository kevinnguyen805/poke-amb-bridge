import { saveLink, listLinks } from "../src/links/store";
import { fetchReadable } from "../src/links/fetch";
import { mintIngestToken } from "../src/links/ingestToken";

// MCP server implemented as a plain Streamable-HTTP JSON-RPC endpoint (edge Web handler).
// No SDK — the Node-only MCP SDK can't run on this project's edge runtime.
export const config = { runtime: "edge" };

const SHORTCUT_URL = "https://www.icloud.com/shortcuts/38066270bde04dd5bb6da2b144111f61";

// "Save to Poke" — silent background save into the user's link list (vs. Message Poke, which
// opens a chat). Overridable so the link can be repointed without a deploy when republished.
const SAVE_SHORTCUT_URL =
  process.env.SAVE_SHORTCUT_URL ?? "https://www.icloud.com/shortcuts/df3977a858984c3586bc636c3d8ed727";
const INGEST_URL = "https://poke-amb-bridge.vercel.app/links/ingest";

function saveToPokeSetupText(token: string): string {
  return (
    `Here's everything you need for the "Save to Poke" Shortcut — links you share from any app will land in your list here.\n\n` +
    `Your personal Save to Poke key (treat it like a password):\n${token}\n\n` +
    `Setup (one time, ~1 minute):\n` +
    `1. Install the Shortcut: ${SAVE_SHORTCUT_URL}\n` +
    `2. If you're asked for your "Save to Poke key" while adding it, paste the key above — done.\n` +
    `3. Older copy of the Shortcut (no question asked)? Open it in the Shortcuts app → "Get Contents of URL" → Headers → ` +
    `set "x-poke-key" to the key above, and delete any "x-poke-user-id" header — your key already identifies you. ` +
    `The URL should be ${INGEST_URL}\n\n` +
    `Then share any page → "Save to Poke" → ask me here to list your saved links.`
  );
}
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
  `The Shortcut install link is ${SHORTCUT_URL} — when the user asks how to share links from other apps, you can give them ` +
  "this link and these steps directly, no tool call required: after installing, in any app tap Share → \"Message Poke\" → " +
  "a Poke chat opens with the link pre-filled → tap Send. " +
  "Do NOT act on a shared link automatically: only call save_link when they ask to save/bookmark, only call list_links " +
  "when they ask to see saved links, only call fetch_link when they ask about a page's contents, and only call " +
  "get_share_shortcut when they ask how to send you links from other apps (it returns this same link and steps). " +
  'There is also a silent-save Shortcut, "Save to Poke": shared links are saved straight into the user\'s list with no ' +
  "chat round-trip. When the user wants that (or asks to set up Save to Poke), call setup_save_to_poke — it returns " +
  "their personal key plus install steps; relay them verbatim, including the full key.";

const TOOLS = [
  {
    name: "get_share_shortcut",
    description:
      "Return the iOS 'Message Poke' Shortcut install link and setup steps so the user can share links to Poke from any app's Share Sheet. Call when the user asks how to share links with you or wants the shortcut.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "setup_save_to_poke",
    description:
      "Set up the 'Save to Poke' iOS Shortcut for this user: mints their personal save key and returns it with the " +
      "Shortcut install link and steps. Call when the user wants to save links silently from their phone's share " +
      "sheet without opening a chat. Relay the result verbatim, including the full key.",
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

// Data tools touch user data (read/write/fetch) so they require the scoped key; the static
// get_share_shortcut + discovery methods (initialize/tools/list/ping) stay open. Poke sends
// the key as an `x-poke-key` header (set in its MCP integration config); value = POKE_SCOPED_KEY.
const SCOPED_KEY = process.env.POKE_SCOPED_KEY ?? "pk_shortcut_demo";
const DATA_TOOLS = new Set(["save_link", "list_links", "fetch_link"]);

/** Constant-time string comparison (no early-out on first mismatch). */
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function callTool(name: string, args: any, userId: string): Promise<string> {
  switch (name) {
    case "get_share_shortcut":
      return SHORTCUT_INFO;
    case "setup_save_to_poke": {
      // Open by design: public-recipe installers arrive with no API key, but Poke always
      // auto-injects the caller's own X-Poke-User-Id — the one place we can learn who the
      // user is. The minted token is a WRITE-ONLY capability (accepted only by /links/ingest),
      // so an unauthenticated mint can never become a data leak.
      if (!userId || userId === "anonymous") {
        return "I can only set up Save to Poke from inside a Poke chat (no user id arrived with this request). Please ask again via Poke.";
      }
      const token = await mintIngestToken(process.env.INGEST_TOKEN_SECRET ?? SCOPED_KEY, userId);
      return saveToPokeSetupText(token);
    }
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
  // Diagnostic: surfaces which JSON-RPC method / tool Poke actually invokes (Vercel runtime logs).
  // AUTH DIAGNOSTIC — Vercel's log viewer shows only the first ~30 chars of ONE line per request,
  // so fold everything into a single front-loaded line: a=credential-matched, then how it arrived
  // (Bearer / xkey / rawauth / none), then the user-id prefix. Never logs the raw secret.
  const authHdr = req.headers.get("authorization") ?? "";
  const bearer = /^bearer /i.test(authHdr) ? authHdr.slice(7) : "";
  const xkeyHdr = req.headers.get("x-poke-key") ?? "";
  const cred = bearer !== "" ? "Bearer" : xkeyHdr !== "" ? "xkey" : authHdr !== "" ? "rawauth" : "none";
  const authed =
    (bearer !== "" && safeEq(bearer, SCOPED_KEY)) || (xkeyHdr !== "" && safeEq(xkeyHdr, SCOPED_KEY));
  const rawUid = req.headers.get("x-poke-user-id");
  const uid8 = rawUid === null ? "absent" : rawUid === "" ? "empty" : rawUid.slice(0, 8);
  console.log(
    `MCP_REQ a=${authed ? 1 : 0} ${cred} u=${uid8} method=${method ?? "?"} tool=${params?.name ?? "-"} accept=${wantsSse(req) ? "sse" : "json"}`,
  );

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
        const name = params?.name;
        // Gate data tools (save/list/fetch); get_share_shortcut stays open. Enforcement is behind
        // MCP_AUTH_ENFORCE so this ships diagnostic-only first (logs above, no rejection).
        if (
          typeof name === "string" &&
          DATA_TOOLS.has(name) &&
          !authed &&
          process.env.MCP_AUTH_ENFORCE === "true"
        ) {
          return err(req, id, -32001, `unauthorized: tool '${name}' requires authentication (Bearer API key or x-poke-key)`);
        }
        const text = await callTool(name, params?.arguments ?? {}, userId);
        return ok(req, id, { content: [{ type: "text", text }] });
      }
      default:
        return err(req, id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return err(req, id, -32603, String((e as Error)?.message ?? e));
  }
}
