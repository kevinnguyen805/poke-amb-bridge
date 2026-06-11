import { saveLink, listLinks } from "../src/links/store";
import { fetchReadable } from "../src/links/fetch";
import { mintIngestToken } from "../src/links/ingestToken";
import { SHORTCUT_VERSION, SHORTCUT_RELEASED } from "../src/links/shortcutMeta";

// MCP server implemented as a plain Streamable-HTTP JSON-RPC endpoint (edge Web handler).
// No SDK — the Node-only MCP SDK can't run on this project's edge runtime.
export const config = { runtime: "edge" };

const SHORTCUT_URL = "https://www.icloud.com/shortcuts/38066270bde04dd5bb6da2b144111f61";

// "Save to Poke" — silent background save into the user's link list (vs. Message Poke, which
// opens a chat). Default = the Apple-signed .shortcut hosted on this bridge (built with
// `shortcuts sign -m anyone`, import question included); env-overridable to an iCloud link.
const SAVE_SHORTCUT_URL = process.env.SAVE_SHORTCUT_URL ?? "https://poke-amb-bridge.vercel.app/save-to-poke.shortcut";
const INGEST_URL = "https://poke-amb-bridge.vercel.app/links/ingest";
const SETUP_PAGE_URL = "https://poke-amb-bridge.vercel.app/setup";

// The deliverable is a LINK, not a raw key: chat surfaces paraphrase or withhold
// password-looking strings and poke.com's chat has no copy affordance. The /setup page
// (same token in ?k=) owns the copy button + Shortcut download. Key kept inline below
// only as a fallback for users who can tap nothing.
function saveToPokeSetupText(token: string): string {
  return (
    `Here's your personal "Save to Poke" setup link — open it on your iPhone and follow the two steps there (~1 minute):\n\n` +
    `${SETUP_PAGE_URL}?k=${token}\n\n` +
    `That page lets you copy your save key and install the Shortcut (${SAVE_SHORTCUT_URL}). ` +
    `If you can't open links here, your save key is: ${token} — get the Shortcut at the URL above and paste the key when it asks.\n` +
    `(Upgrading an older copy of the Shortcut that never asked for a key? In the Shortcuts app set the "x-poke-key" header to that key, ` +
    `delete any "x-poke-user-id" header, and keep the URL ${INGEST_URL})\n\n` +
    `Current Shortcut version: v${SHORTCUT_VERSION} (${SHORTCUT_RELEASED}). Installed copies never auto-update — if you added the Shortcut before that date, delete it and re-download from the link above.\n\n` +
    `Once it's installed, test it right away: open any article, tap Share → "Save to Poke". Success is deliberately quiet — a short vibration and the share sheet closes. No banner, no chat opens; the link lands silently in your private list. (Only failures show an alert, with the reason.)\n\n` +
    `What it's for: anything you'd otherwise lose in open tabs — articles to read later, products you're comparing, recipes, job posts, places to try, gift ideas, videos.\n\n` +
    `Then just ask me here, anytime: "what did I save this week?", "find my saved links about <topic>", or "summarize that article I saved yesterday". You can also save with context in this chat — "save <url> with a note 'for the offsite' and tag travel" — and pull things back by tag or topic later.`
  );
}
const SHORTCUT_INFO =
  `Here's the "Message Poke" Shortcut — install it once to share links to Poke from any app:\n${SHORTCUT_URL}\n\n` +
  `After installing: in any app tap Share → "Message Poke" → a Poke chat opens with your link pre-filled → tap Send.\n` +
  `(Want links saved silently instead, with no chat? That's the separate "Save to Poke" Shortcut — ask me to set up Save to Poke.)`;

// MCP `instructions` — onboarding behavior Poke reads at connect time. This is the
// home for "introduce the abilities, don't auto-act"; tool descriptions only gate calls.
const INSTRUCTIONS =
  "Link Companion lets the user save, search, read, and share links — all inside this chat. " +
  "There are TWO DIFFERENT iOS Shortcuts; never substitute one for the other. " +
  '(A) "Save to Poke" — silently saves shared links into the user\'s list, no chat round-trip. Its setup MUST come from the ' +
  "setup_save_to_poke tool: call it whenever the user wants to set up Save to Poke, save links from their phone's share " +
  "sheet, or asks for their key or 'the shortcut' after installing this recipe. Relay the tool result verbatim — the full " +
  "setup link (including its ?k= part) must reach the user as a tappable URL. Never answer that request with any other " +
  "shortcut link, including the Message Poke one below. " +
  '(B) "Message Poke" — OPENS A CHAT with the shared link pre-filled; it does not save anything. Only when the user ' +
  `explicitly wants to message links into this chat, give ${SHORTCUT_URL} with these steps (or call get_share_shortcut): ` +
  'after installing, in any app tap Share → "Message Poke" → a Poke chat opens with the link pre-filled → tap Send. ' +
  "When the user first interacts, briefly introduce what you can do: save links, find them later by keyword, " +
  "read/summarize pages, and silent share-sheet saving via Save to Poke. Then wait for them to choose. " +
  "Do NOT act on a shared link automatically: only call save_link when they ask to save/bookmark, only call list_links " +
  "when they ask to see saved links, and only call fetch_link when they ask about a page's contents. " +
  "USAGE GUIDANCE — after a user finishes Save to Poke setup, or whenever they ask how to use it, what to save, or " +
  "what sharing a link does, explain the loop in plain terms: " +
  "(1) Sharing a page to 'Save to Poke' saves it silently into their private list — success is just a short vibration " +
  "and the share sheet closing; there is NO banner, no chat starts, and Poke does not message them about it. Only " +
  "failures show an alert with the reason. " +
  "(2) Suggest they test it immediately on any article — a quiet vibration with no error alert means it worked, and " +
  "they can confirm by asking to list their saved links. " +
  "(3) Good things to save: articles to read later, products being compared, recipes, job posts, places to try, " +
  "gift ideas, videos — anything they'd otherwise lose in open browser tabs. " +
  "(4) Retrieval is conversational — give 2–3 concrete example asks, e.g. 'what did I save this week?', " +
  "'find my links about pricing', 'summarize that article I saved yesterday' (list_links to find, fetch_link to read). " +
  "(5) Tailoring: in chat they can save with context ('save this with a note and tag it gifts' → save_link with " +
  "note/tags), then filter by those later; they can also ask for digests like 'summarize everything I saved this week'. " +
  "Links saved via the Shortcut arrive tagged 'shortcut'; saves made in chat can carry any notes/tags they like. " +
  "Offer this guidance once, briefly — do not repeat it every time they save. " +
  "TROUBLESHOOTING Save to Poke — these are the verified facts; never invent server-side explanations beyond them. " +
  "(1) The Shortcut does NOT check HTTP status codes; it branches on the `saved` key in the response body, and the " +
  "server's 201 response IS the success path — never tell a user a 200-vs-201 mismatch is the problem. " +
  "(2) The save endpoint authenticates with the x-poke-key header alone; the spk_ key itself carries the user's " +
  "identity — no x-poke-user-id or other header is needed by the Shortcut. " +
  `(3) Installed Shortcuts never auto-update; the current version is v${SHORTCUT_VERSION} (${SHORTCUT_RELEASED}). ` +
  'If a user reports a Shortcut error ("url has no value", empty/missing variable slots, saves that fail), the fix is ' +
  "always: delete EVERY copy of the Save to Poke Shortcut on their device, call setup_save_to_poke, and have them " +
  "re-download from their setup link and paste the key again. " +
  "(4) If you are unsure why something failed, say so and re-run setup_save_to_poke — do not guess.";

const TOOLS = [
  {
    name: "get_share_shortcut",
    description:
      "Return the iOS 'Message Poke' Shortcut install link — it OPENS A CHAT with the shared link pre-filled; it does not save anything. Only call when the user explicitly wants to message links into this chat. NOT for 'Save to Poke' — silent saving setup must come from setup_save_to_poke instead.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "setup_save_to_poke",
    description:
      "Set up the 'Save to Poke' iOS Shortcut for this user: mints their personal setup link (which carries their save " +
      "key) and returns it with steps. Call when the user wants to save links silently from their phone's share sheet " +
      "without opening a chat. Relay the result verbatim — the full setup URL including its ?k= parameter.",
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

// Data tools touch user data (read/write/fetch) so they require a credential: either the
// scoped key (Bearer / x-poke-key — Kevin's original connection) or a Poke-injected
// x-poke-user-id (recipe installers — keyless by Poke's design; tools scope to that uid).
// Static get_share_shortcut + discovery methods (initialize/tools/list/ping) stay open.
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
        //
        // A Poke-injected x-poke-user-id counts as the credential: recipe installers are
        // keyless FOREVER (Poke's shared connections carry no API key), and answering them
        // with -32001 "unauthorized" wedges Poke's client into a needs-authorization state
        // whose authorize link 500s poke.com-side (we expose no OAuth) — learned from the
        // first real installer, 2026-06-10. Tools scope to the injected uid, the same trust
        // the spk_ token mint already extends. -32001 now only answers fully-anonymous
        // direct hits (no key AND no user id — curl probes; Poke always injects the uid).
        if (
          typeof name === "string" &&
          DATA_TOOLS.has(name) &&
          !authed &&
          (rawUid === null || rawUid === "") &&
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
