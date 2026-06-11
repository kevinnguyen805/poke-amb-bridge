# Link Companion — Design Spec

**What it is:** a Poke Recipe that turns Poke into a personal link manager. The user
sends Poke a link; Poke can **save** it, **search** saved links, **read/summarize** a
page, or hand over an **iOS Shortcut** for sharing links from any app. Nothing happens
to a link unless the user asks.

**Scale (be honest about it):** this is a small system — 4 tools, one ~130-line edge
handler, two helper modules, and one Postgres table. The spec documents exactly that.

---

## 1. System at a glance

```
   iPhone / Poke chat
        │  (user sends a link or a request)
        ▼
   Poke (MCP client)  ──Authorization + X-Poke-User-Id──┐
        │                                                │
        │  JSON-RPC 2.0 over Streamable HTTP             │
        ▼                                                │
   api/mcp.ts  (Vercel Edge function)                    │
        ├── get_share_shortcut → static iCloud link      │
        ├── save_link  ┐                                 │
        ├── list_links ┼─→ src/links/store.ts ──→ Neon Postgres (saved_links)
        └── fetch_link ──→ src/links/fetch.ts ──→ outbound HTTP (SSRF-guarded)
```

There is no UI, no auth server, no queue. Poke is the only client; the server is one
stateless function plus a database.

---

## 2. Components

| File | Responsibility |
|---|---|
| `api/mcp.ts` | The whole MCP server: JSON-RPC routing (`initialize` / `tools/list` / `tools/call` / `ping` / notifications), the tool registry, and `callTool()` dispatch. Edge runtime. |
| `src/links/store.ts` | Neon-backed per-user link storage. Lazy table migration; `saveLink()` / `listLinks()`. |
| `src/links/fetch.ts` | `fetchReadable(url)` — SSRF-guarded page fetch → stripped text (≤8k chars). |
| `vercel.json` | Rewrite `/mcp` → `/api/mcp` (plus the other doorways from the wider repo). |
| `test/mcp.test.ts` | Unit tests for `initialize` (instructions), `tools/list`, and `get_share_shortcut`. |

> The rest of the repo (`src/spine/*`, `api/share`, `api/amb/ingress`, vCard/wallet
> doorways) is the **earlier bridge experiment** and is independent of the recipe. Link
> Companion is just the `api/mcp.ts` + `src/links/*` slice.

---

## 3. The four tools

| Tool | Input | Effect | Gating (from the tool description) |
|---|---|---|---|
| `get_share_shortcut` | none | Returns the "Message Poke" iCloud Shortcut link + setup steps. | Only when the user asks how to share links / wants the shortcut. |
| `save_link` | `url` (req), `note?`, `tags?` | Inserts a row into `saved_links` for this user. | Only when the user explicitly says to save/bookmark. |
| `list_links` | `query?`, `limit?` (default 20) | Returns the user's links, optionally `ILIKE`-filtered. | Only when the user asks to see saved links. |
| `fetch_link` | `url` (req) | Fetches the page and returns readable text for Poke to summarize. | Only when the user asks about the page's contents. |

Each tool's JSON-Schema `inputSchema` is defined in the `TOOLS` array in `api/mcp.ts`.
The gating language lives in the tool `description`s — that's what tells Poke *when* to
call each one.

---

## 4. Data model

One table, created lazily on first write (`ensure()` in `store.ts`):

```sql
CREATE TABLE saved_links (
  id          bigserial PRIMARY KEY,
  poke_user_id text NOT NULL,   -- the X-Poke-User-Id header value
  url         text NOT NULL,
  note        text,
  tags        text,             -- comma-joined; split back to string[] on read
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_links_user_idx ON saved_links (poke_user_id, created_at DESC);
```

Tags are stored as a comma-joined string for simplicity (no array type, no join table) —
deliberately minimal for a single-table bookmark list.

---

## 5. Identity & multi-tenancy

Poke sends an **`X-Poke-User-Id`** header on every call. `api/mcp.ts` reads it
(`req.headers.get("x-poke-user-id") ?? "anonymous"`) and passes it as `poke_user_id` to
every store call. Every query is `WHERE poke_user_id = $1`, so each Poke user sees only
their own links. No user accounts, no login — the header *is* the tenant key.

---

## 6. Onboarding model (two layers — this is the part that confuses people)

Onboarding is split across **two places** that do different jobs:

| Layer | Where | Controls | If empty… |
|---|---|---|---|
| **Recipe first message** | Kitchen field `prefilledFirstText` | The opening message (in the **user's voice**) that starts the chat when someone activates the recipe. | Opening the recipe starts a **silent** chat — feels broken. |
| **Server instructions** | MCP `initialize` → `instructions` (in `api/mcp.ts`) | How Poke *behaves*: introduce the 4 abilities, don't auto-act on a shared link. | Poke has tools but no framing for the greeting. |

Key point: the **server `instructions` field does not make the conversation start** — only
`prefilledFirstText` does. They're complementary: `prefilledFirstText` kicks off the chat;
`instructions` shapes how Poke responds once a chat exists.

`inputContext` ("what context Poke needs from the user") is unused here — Link Companion
needs nothing from the user to work, so it's left blank.

---

## 7. Security

- **Per-user isolation** — every store query is scoped by `poke_user_id`; no cross-user reads.
- **SSRF guard** (`fetch.ts`) — blocks `localhost`, `127.*`, `10.*`, `192.168.*`, `169.254.*`,
  `172.16–31.*`, `*.internal`, `*.local`, `metadata`; http/https only; 12s timeout; 8k cap.
  (Hostname-pattern based, not DNS-resolving — adequate for v1, noted for hardening.)
- **No secrets in the repo** — `DATABASE_URL` is a Vercel env var; the public GitHub repo
  carries no credentials.
- **Read/parameterized SQL** — all queries use parameter binding (`$1…`), no string interpolation.

---

## 8. Deployment & runtime

- **Host:** Vercel, **edge runtime** (`export const config = { runtime: "edge" }`).
- **DB:** Neon Postgres via `@neondatabase/serverless` `neon()` **HTTP driver** with
  `{ fullResults: true }`.
- **CI/CD:** GitHub `kevinnguyen805/poke-amb-bridge` → push to `main` → CI (typecheck + tests)
  → Vercel auto-deploy. Live at `https://poke-amb-bridge.vercel.app/mcp`.
- **Crypto/portability:** Web Crypto only (no `node:crypto`), so the same code runs in edge
  prod and Node 20 tests.

---

## 9. Key engineering decisions (the load-bearing ones)

1. **Plain JSON-RPC, no MCP SDK.** The Node-only `@modelcontextprotocol/sdk`
   `FUNCTION_INVOCATION_FAILED`s on this project's edge runtime. The server is implemented
   as a hand-written Streamable-HTTP JSON-RPC Web handler instead — ~130 lines, zero SDK.
2. **Edge runtime + Web Crypto.** Vercel's default Node runtime ignored Web `Request→Response`
   handlers (every call 500'd). Edge + Web Crypto fixed it and stays Node-test-portable.
3. **Neon HTTP, not WebSocket Pool.** A cached `Pool` goes stale across serverless
   invocations (2nd query hangs ~30s). The stateless `neon()` HTTP driver is correct here.
4. **`instructions` in `initialize`, not a recipe field.** Behavioral framing belongs in the
   MCP handshake so it travels with the server regardless of how the recipe is configured.
5. **SSE-framed responses (content-negotiated).** MCP Streamable-HTTP clients (Poke) send
   `Accept: text/event-stream` and expect the JSON-RPC result delivered as a single Server-Sent
   Event (`event: message` / `data: <json>`). Returning bare `application/json` makes those
   clients fail with a generic, message-less error. The server negotiates on `Accept`: SSE for
   MCP clients, plain JSON for simple clients/browsers; a GET SSE-stream open returns `405`
   (no server-initiated stream). *This was a real production bug — `get_share_shortcut` "failed"
   in Poke while every request returned HTTP 200; the break was transport framing, not the tool.*

---

## 10. Limits & non-goals

- No dedup — saving the same URL twice stores two rows (acceptable for v1).
- No delete/edit tool — only save/list (add later if needed).
- `fetch_link` returns raw stripped text, not a reader-mode extraction.
- Not a general AMB bridge — that's the separate, dormant `src/spine/*` experiment.

## 11. Extending it

Add a tool: append to the `TOOLS` array (name + description + `inputSchema`) and add a
`case` in `callTool()`. Write a test in `test/mcp.test.ts`, `git push` → it's live. Because
the recipe points at the same URL, no recipe change is needed for new tools.
