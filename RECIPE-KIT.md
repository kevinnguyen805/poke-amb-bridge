# Link Companion — Poke Recipe Kit

Everything needed to publish the recipe. The MCP server is already live:
**`https://poke-amb-bridge.vercel.app/mcp`**

---

## Step 0 — Log in (only you can do this; it's browser-interactive)

In the Claude Code prompt, run with the `!` prefix so the output lands in our session:

```
! npx poke@latest login
```

Finish the browser sign-in, then tell me **"done"** — I'll run the connect step for you.

---

## Step 1 — Connect the MCP server (I run this once you're logged in)

```
npx poke@latest mcp add https://poke-amb-bridge.vercel.app/mcp -n "Link Companion"
```

(Equivalent UI path: poke.com/integrations/new → paste the URL → name it "Link Companion".)

---

## Step 2 — Publish the recipe in the Kitchen (you, in browser)

Go to **poke.com/kitchen → New Recipe**. Fill in:

| Field | Value |
|---|---|
| **Name** | `Link Companion` |
| **Tagline** | `Save, search, read, and share links — right inside Poke.` |
| **Integration** | select **Link Companion** (the MCP you just added) |
| **Onboarding context** | paste the block below |

Publish → you get a shareable **`poke.com/r/<code>`** link.

---

## Onboarding context (paste verbatim)

> Link Companion gives you four link superpowers. When a user first connects, greet them and briefly list what you can now do with any link they share — then wait for them to choose. Do **not** act on links automatically.
>
> What you can do with a shared link:
> - **Save it** — store the link to their personal list. (tool: `save_link`)
> - **Find it later** — search their saved links by keyword. (tool: `list_links`)
> - **Read it for them** — fetch the page's text so you can summarize or answer questions about it. (tool: `fetch_link`)
> - **Share to you from any app** — hand them the one-tap iOS "Message Poke" Shortcut so they can send links from any app's Share Sheet. (tool: `get_share_shortcut`)
>
> Rules:
> - When a user shares a link, do **not** automatically save, fetch, or act on it. Acknowledge it, and the first time, briefly mention these four things you can do — then let them pick.
> - Only call `save_link` when they explicitly say to save or bookmark something.
> - Only call `list_links` when they ask to see what they've saved.
> - Only call `fetch_link` when they ask about a page's contents (summarize / "what does this say").
> - Offer `get_share_shortcut` when they ask how to send you links from other apps.

---

## What's behind it (for reference)

- **Server:** plain Streamable-HTTP JSON-RPC MCP on Vercel Edge (`api/mcp.ts`), per-user via Poke's `X-Poke-User-Id` header.
- **Tools:** `get_share_shortcut`, `save_link`, `list_links`, `fetch_link` (SSRF-guarded).
- **Storage:** Neon Postgres `saved_links`, scoped per Poke user.
- **Shortcut handed out:** the working "Message Poke" iCloud shortcut
  `https://www.icloud.com/shortcuts/38066270bde04dd5bb6da2b144111f61`
  (opens the **AMB** Poke thread with the shared link pre-filled → user taps Send).
