# "Save to Poke" — iOS Shortcut spec

Share a link from any app → it's saved into your Link Companion list (the same
Neon `saved_links` store the Poke recipe reads via `list_links`). No message
thread, no manual tap, silent background save.

Verified live against `POST https://poke-amb-bridge.vercel.app/links/ingest`
(round-trip confirmed: ingest → `201` → `list_links` reads it back).

---

## 1. Endpoint contract (source of truth)

| | |
|---|---|
| **URL** | `https://poke-amb-bridge.vercel.app/links/ingest` |
| **Method** | `POST` |
| **`x-poke-key`** | auth — your `POKE_SCOPED_KEY` (now set in prod; the old `pk_shortcut_demo` no longer works — see §5) |
| **`x-poke-user-id`** | **whose list** — your **personal** Poke user id (kept private; see §4). Omit → `anonymous` |
| **`Content-Type`** | `application/json` (Shortcuts sets this automatically for a JSON body) |

**Request body**

```json
{
  "url": "https://example.com/article",   // REQUIRED — http/https only, ≤2048 chars
  "note": "optional annotation",           // optional, ≤512 chars
  "tags": ["shortcut"]                      // optional, array of strings
}
```

**Success** → `201`
```json
{ "saved": { "id": 3, "url": "…", "note": "…", "tags": ["…"], "createdAt": "2026-06-10T07:00:39.934Z" } }
```

**Errors** — `401` bad/missing key · `400` missing/invalid url (or non-http(s)) · `429` >60 req/min per IP · `503` store unavailable.

> Note: the `url` is only **stored**, never fetched — so there's no SSRF surface here. (Fetching is the separate, SSRF-guarded `fetch_link` MCP tool.)

---

## 2. Build it in the Shortcuts app

**Create + enable Share Sheet**
1. Shortcuts → **+** → name it `Save to Poke`.
2. Tap **ⓘ** (settings) → toggle **Show in Share Sheet** ON.
3. **Share Sheet Types** → select **URLs** (optionally *Safari web pages*, *Text*). Deselect the rest to keep it focused.

**Actions**
4. **Get URLs from Input** — input = **Shortcut Input**. (Robustly pulls a URL whether you shared a Safari page, a raw link, or text containing one.) Output: `URLs`.
   - *(optional)* **Get Item from List** → *First Item*, if a page yields several URLs.
5. **Get Contents of URL**:
   - **URL:** `https://poke-amb-bridge.vercel.app/links/ingest`
   - tap **Show More** →
   - **Method:** `POST`
   - **Headers** (＋ for each):
     - `x-poke-key` → `<your POKE_SCOPED_KEY>`  *(the value set in §5 — not the demo key)*
     - `x-poke-user-id` → `<your personal Poke user id>`  *(§4 — kept private)*
   - **Request Body:** **JSON** → add fields:
     - `url`  *(Text)*  = the **URLs** magic variable from step 4
     - *(optional)* `note`  *(Text)*  = e.g. `via Shortcut`
     - *(optional)* `tags`  *(Array)*  → one item: `shortcut`
6. *(optional)* **Show Notification** = `Saved to Poke ✓`.
   - For a richer confirm: **Get Dictionary Value** (key `saved.url`) from step 5's output, then show that.

**Use it:** in Safari (or any app) → **Share** → **Save to Poke**. The link lands in your Poke list.

---

## 3. Test without the phone (curl)

```bash
curl -s -X POST https://poke-amb-bridge.vercel.app/links/ingest \
  -H "x-poke-key: <your-POKE_SCOPED_KEY>" \
  -H "x-poke-user-id: <your-personal-poke-user-id>" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/article","tags":["shortcut"]}' -w "\n[%{http_code}]\n"
# expect: {"saved":{...}}  [201]
```

---

## 4. Your Poke user id (kept private — not in this public repo)

Use **your personal Poke user id** — the UUID Poke maps to your personal companion list. It's
**not committed here** (this repo is public); use the value you have separately. Put it in the
`x-poke-user-id` header. Verified end-to-end: a marker link ingested under it read back via
`list_links` alongside your real saves.

> 🔒 **Why it's private:** the `/mcp` read path (`list_links`) is currently **unauthenticated** —
> it returns whatever `x-poke-user-id` you pass, with no key. So your user id acts as a
> *read-credential* for your link list; publishing it would let anyone read your saves. Treat it
> like the `x-poke-key`.
>
> ⚠️ **Not the business id.** `6e67a89b-cd37-4c25-ad21-1b942f2a0f14` is Poke's **business-level
> AMB id** (public, but the wrong bucket for your personal list).
>
> ⚠️ **Before a public multi-user recipe:** Poke exposes per-user ids, so scoping works if the
> recipe lets Poke send each user's own id (don't hardcode one) — **and** the unauthenticated
> `/mcp` read path needs real auth (today any known user id reads that user's links). See memory.

---

## 5. Security — done ✅

`POKE_SCOPED_KEY` is now set in production (added 2026-06-10) and this deploy enforces it,
so the public `pk_shortcut_demo` **no longer authenticates** — the endpoint is closed to
anyone without the real key. Use that key as the Shortcut's `x-poke-key`.

- The value lives in **Vercel → Project → Settings → Environment Variables** — it is **not**
  stored in this repo. Keep it secret; never commit it.
- Rotate any time: `vercel env rm POKE_SCOPED_KEY production`, then `vercel env add …`,
  redeploy, and update the Shortcut's header.

---

## 6. Optional enhancements (not built — say the word)

- **`source` provenance** (Poke's idea): the endpoint ignores unknown fields, so you
  *can* send `"source":"ios-shortcut"` today — but it isn't stored. To keep it, send it
  as a tag (`"tags":["ios-shortcut"]`) or add a `source` column.
- **Text-only shares** (no URL): unsupported — the store is link-centric (`url` required).
  Saving highlighted text with no link would need a schema change.
