# Link Companion — Instructions Manual

A personal link manager that lives inside Poke. Send Poke a link, then save it, search
your saved links, have Poke read/summarize a page, or grab an iOS Shortcut to share links
from any app. Poke never acts on a link unless you ask.

- **Recipe link:** https://poke.com/r/af3fh3EA9B_
- **MCP server:** https://poke-amb-bridge.vercel.app/mcp
- **Code:** `~/dev/poke-amb-bridge/` (`api/mcp.ts`, `src/links/*`)

---

## 1. The mental model (read this first)

Link Companion is **two pieces** that people mix up:

1. **The MCP server** — the code on Vercel that actually *does* things (save/search/read/share).
   Always on. You almost never touch it.
2. **The recipe** — the thing you publish in the **Kitchen** at poke.com. It wraps the
   server, adds a name + an **opening message**, and produces the shareable `poke.com/r/…` link.

> **Your onboarding confusion was real and has one cause:** the recipe's **first-message
> field was empty**, so opening the recipe started a *silent* chat. Fixing that is Section 2.

---

## 2. Fix onboarding — populate the recipe's first message ⭐

A Poke recipe has two onboarding fields (poke.com/kitchen → edit your recipe):

| Field | What it is | What to put |
|---|---|---|
| **`prefilledFirstText`** ("Prefilled first message") | The opening message that starts the chat when someone activates the recipe. **It's in *your* voice** — a message *you* send to Poke. | The copy below. |
| **`inputContext`** ("What context Poke needs from the user") | Info Poke should collect before starting. | **Leave blank** — Link Companion needs nothing to work. |

**Paste this into the first-message (`prefilledFirstText`) field** (user-voiced, so it reads
naturally as you opening the chat):

```
I just added Link Companion. What can you do with links I send you?
```

That's it. When someone activates the recipe, that message starts the chat, and Poke —
guided by the server's built-in instructions — replies by introducing the four abilities.

> **Important:** This first-message field is the *only* thing that makes the conversation
> start. The server's behavioral instructions (the "introduce the abilities, don't auto-act"
> rule) are already deployed and shape *how* Poke replies — but they do **not** kick off the
> chat on their own. If onboarding ever feels silent again, check this field first.

---

## 3. How to use it (day to day)

Just talk to Poke in plain language. Examples that map to each ability:

| You say… | Poke does | Tool |
|---|---|---|
| *(paste a link)* | Acknowledges it, lists what it can do — **doesn't save it** | — |
| "save this" / "bookmark that" | Saves the link to your list | `save_link` |
| "what did I save about pricing?" | Searches your saved links | `list_links` |
| "show me my saved links" | Lists everything you've saved | `list_links` |
| "summarize this" / "what does this say?" *(with a link)* | Reads the page and answers | `fetch_link` |
| "how do I share links to you from other apps?" | Sends the iOS "Message Poke" Shortcut | `get_share_shortcut` |

That last one is the bridge to sharing links into the **AMB Poke** thread: install the
Shortcut once, then in any app tap **Share → Message Poke** and your link opens in the Poke
chat, pre-filled, ready to send.

---

## 4. Share the recipe with others

Send anyone the link: **https://poke.com/r/af3fh3EA9B_**

They'll see a "this recipe hasn't been reviewed by the Poke team yet" warning (normal for
third-party recipes) → **Continue** → it's added to their Poke. Each person's saved links
are private to them (scoped by their Poke user ID).

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **Opening the recipe does nothing / silent chat** | `prefilledFirstText` is empty | Add the first message — Section 2. |
| **3 "Link Companion" integrations** in poke.com/integrations | My earlier `mcp add` retries each registered | They're identical (same URL). Delete two; keep the one the recipe is bound to. |
| **"Recipe hasn't been reviewed" warning** | Normal for third-party recipes | Expected — click Continue. |
| **`npx poke mcp add` hangs with no output** | The CLI needs a TTY; an agent/non-interactive shell hangs it | Run it yourself: `! npx poke@latest mcp add <url> -n "Link Companion"`, or use poke.com/integrations/new in the browser. |
| **`poke whoami` says "fetch failed"** | Transient network blip to Poke's backend | Re-run it. |
| **A tool doesn't fire when expected** | Poke didn't match your phrasing to the tool's gating | Be explicit ("save this link", "summarize this page"). |
| **A tool returns a "generic failure" in Poke** (server logs show HTTP 200) | The server replied plain JSON; MCP clients need the result framed as SSE (`text/event-stream`) | Fixed in `api/mcp.ts` (content-negotiated SSE). If it recurs, confirm `Accept: text/event-stream` requests get a `text/event-stream` response. |
| **Saved a link twice** | No dedup in v1 | Harmless — it stores both rows. |

---

## 6. Edit or extend it

The recipe points at a fixed URL, so changing behavior = changing the server, then pushing:

1. Edit `api/mcp.ts` (add a tool to the `TOOLS` array + a `case` in `callTool()`), or tweak
   the `INSTRUCTIONS` string to change the greeting behavior.
2. Add/update a test in `test/mcp.test.ts`; run `npx vitest run`.
3. `git push origin main` → CI runs → Vercel auto-deploys. Live in ~30s.

No recipe edit needed for server changes — except the **onboarding fields** (Section 2),
which live on the recipe in the Kitchen, not in the code.

---

## 7. Quick reference

- **Recipe:** https://poke.com/r/af3fh3EA9B_
- **MCP URL:** https://poke-amb-bridge.vercel.app/mcp
- **Shortcut handed out:** https://www.icloud.com/shortcuts/38066270bde04dd5bb6da2b144111f61
- **Tools:** `get_share_shortcut`, `save_link`, `list_links`, `fetch_link`
- **First message to paste:** `I just added Link Companion. What can you do with links I send you?`
- **Full publish steps:** `RECIPE-KIT.md` · **Architecture:** `DESIGN-SPEC.md`
