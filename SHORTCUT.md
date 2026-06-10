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
| **`x-poke-user-id`** | **whose list** to save to — must match the id Poke uses (see §4). Omit → saves to `anonymous` |
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
     - `x-poke-user-id` → `<your-poke-user-id>`  *(§4)*
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
  -H "x-poke-user-id: <your-poke-user-id>" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/article","tags":["shortcut"]}' -w "\n[%{http_code}]\n"
# expect: {"saved":{...}}  [201]
```

---

## 4. Finding your Poke user id (the one detail that makes it cohere)

The Shortcut's `x-poke-user-id` **must equal** the `X-Poke-User-Id` Poke sends when
you use the recipe — otherwise Shortcut-saved links sit in a *different bucket* than
your Poke chat reads from.

To find it: **Vercel → project `poke-amb-bridge` → Logs (Runtime)**, then interact with
the Link Companion recipe in Poke (e.g. ask it to list your links). Read the
`MCP_REQ method=… user=<id>` line — that `<id>` is your value. Paste it into the
Shortcut's `x-poke-user-id` header.

(For a personal single-user setup this is a one-time lookup; for a multi-user recipe
each user needs their own id baked into their own copy of the Shortcut.)

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
