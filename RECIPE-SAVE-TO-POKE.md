# "Save to Poke" — recipe kit
A Poke recipe + iOS Shortcut pair: share any link from any app → it lands silently in your Link Companion list. **Setup is one chat message + one tap** — no API-key hunting, no endpoint URLs, no user-id handling.
## The end-user experience (what we optimized for)
1. **Install the recipe** → it opens with the prefilled first message.
  
2. Poke calls `setup_save_to_poke` and replies with your **personal setup link** (`/setup?k=spk_…`).
  
3. **Tap the link** → the page has a Copy-key button + the Shortcut download. Add the Shortcut, paste when asked. Done — share sheet → "Save to Poke" from then on.
  

The user never sees an endpoint URL, never edits headers, never learns what a user id is.

> **Why a link, not a raw key (learned live 2026-06-10):** Kevin's first real test failed — Poke wouldn't relay the `spk_` key verbatim and poke.com's chat UI has no copy affordance. Chat surfaces treat URLs as atomic (linkified, never paraphrased), so the tool now leads with `https://poke-amb-bridge.vercel.app/setup?k=<token>`; the `/setup` page (edge fn `api/setup.ts`) verifies the token's HMAC before rendering and owns the copy + install steps. Raw key stays in the chat text only as a no-tap fallback.
## How it works (server side, already live)
- New MCP tool `setup_save_to_poke` (in `api/mcp.ts`) — deliberately **open** (not behind `MCP_AUTH_ENFORCE`): the friend-test proved public-recipe installers arrive with _no_ API key but Poke always auto-injects their own `X-Poke-User-Id`. The chat is therefore the one place the server can learn who the user is, so the recipe itself provisions the credential.
  
- The tool mints a **self-authenticating, write-only token**: `spk_<base64url(userId)>.<HMAC-SHA256(secret, userId) truncated>` (`src/links/ingestToken.ts`). No key table, no migration; same user → same token (re-running setup is idempotent). Secret = `INGEST_TOKEN_SECRET`, falling back to `POKE_SCOPED_KEY`.
  
- `POST /links/ingest` accepts `x-poke-key: spk_…` and derives the user **from the token** (a spoofed `x-poke-user-id` header is ignored on this path). The legacy shared-key + header path still works, so Kevin's existing Shortcut install is untouched.
  
### Security model (why an open mint is safe)
- The token is accepted **only** by `/links/ingest` — it can never read links, so the open mint can't leak data.
  
- Worst case, someone who already _knows_ a victim's Poke user id (unguessable UUID) can mint a token and **add** links to that victim's list — same exposure class the project already carries, now bounded write-only and rate-limited (60/min/IP on ingest).
  
- Per-user revocation doesn't exist (token is derived, not stored); rotation is global via `INGEST_TOKEN_SECRET`. Accepted for this tier — escalate to stored per-user tokens or MCP OAuth if/when that matters.
  
## Recipe status (2026-06-10: CREATED programmatically — needs finishing in Kitchen)
The Poke backend API at `https://poke.com/api/v1` was mapped from the `poke@0.4.2` npm package source (CLI token from `~/.config/poke/credentials.json`, limited scopes — connection listing is 403, but the CLI-scoped endpoints work):

- `POST /mcp/connections/cli` `{name, serverUrl, tunnel:false}` → **`tunnel:false` works** (the CLI hardcodes `true`); created a direct remote connection `59025f83-f472-4353-bd97-7bd32d462b2a` → serverUrl `https://poke-amb-bridge.vercel.app/mcp`, authType `none`, status `authenticated`. (`DELETE /mcp/connections/<id>` is the rollback.)
- `POST /mcp/connections/<id>/sync-tools` → 200, all 5 tools synced.
- `POST /mcp/connections/<id>/create-recipe` `{name:"Save to Poke"}` → **recipe `1be1aa74-ed38-45e4-9ebd-b40f7974cf82`, link `https://poke.com/r/w_S3K1zll9V`**.

The public link currently renders **"Recipe Not Found"** (draft state — created with name only). **Programmatic publish is a dead end, verified 2026-06-10 — don't re-probe:** `create-recipe` is idempotent (re-POST returns the same recipeId) but ignores every field except `name` (`prefilledFirstText`/`tagline`/`published` had no effect); `/api/v1/kitchen/*` is a catch-all that 200s empty for any path/method (not a real API); the real recipe-read endpoint (`GET /mcp/connections/<id>/recipes`, found in the poke.com bundle) returns 403 "Insufficient scope" for CLI tokens — the Kitchen editor runs on browser-session auth only. Finish in Kitchen (browser): open poke.com/kitchen → the Save to Poke recipe → set the fields below → publish. NOTE: this recipe rides the NEW keyless connection above, not the original Bearer-authed Link Companion connection — that's correct for public installers (setup tool is open; data tools enforce auth per-user via Poke's injected user id).
## Recipe fields (finish at poke.com/kitchen — browser; `poke mcp add` hangs headless)
| Field | Value |
| --- | --- |
| Name | `Save to Poke` |
| Tagline | `Share any link from any app — it lands in your Poke list, silently.` |
| Integration | the existing Link Companion MCP (`https://poke-amb-bridge.vercel.app/mcp`) — **leave API Key empty**; setup doesn't need it |
| Prefilled first message (USER voice) | `Set up Save to Poke for me — I want to save links from my phone's share sheet.` |
| Input context | _(leave blank — the tool gets everything from the auto-injected user id)_ |

Reminder from the Link Companion launch: only `prefilledFirstText` starts the chat; behavioral framing already lives in the MCP `instructions` (updated to route setup asks to `setup_save_to_poke` and to relay the key verbatim).
## The Shortcut (SOLVED — signed + hosted, no device work needed)

Authored by **`scripts/build-shortcut.py`** (plistlib → binary plist) and Apple-signed on
Kevin's Mac (`shortcuts sign -m anyone` — signed files import fine on iOS 15+; only
*unsigned* ones are blocked). Hosted at
**`https://poke-amb-bridge.vercel.app/save-to-poke.shortcut`** (served
`application/x-apple-as-shortcut`). Rebuild:

```bash
python3 scripts/build-shortcut.py /tmp/stp-unsigned.shortcut
shortcuts sign -m anyone -i /tmp/stp-unsigned.shortcut -o public/save-to-poke.shortcut
```

**v2 structure (15 actions):** Text (key, Import Question) → Get URLs from **Shortcut
Input** → If no URLs: alert "share from the share sheet" + Stop → First Item → POST
`/links/ingest` (`x-poke-key` header) → Get `saved` from response → If present: "Saved to
Poke ✓" notification, else: alert with the server's `error` text.

**v1 lessons baked in (2026-06-10, first real installer):**
- **Variable wiring must use the editor-native encoding** — `WFTextTokenString` +
  `attachmentsByRange`, not the flat `WFTextTokenAttachment` form. v1 used the flat form
  for detect.link's input; it parsed, but rendered as an *unwired* "Get URLs from ⬜" slot
  (Kevin spotted it) and the first installer's save died 400 "url required". Canonical
  encodings were cribbed from editor-built shortcuts in Kevin's own library
  (`~/Library/Shortcuts/Shortcuts.sqlite`, `ZSHORTCUTACTIONS.ZDATA` blobs).
- **Never show unconditional success.** v1's "Saved ✓" banner fired even on a 400 — the
  installer believed the save worked. v2 branches on the response.
- **Guard the no-input case.** Running the Shortcut directly (not via share sheet) now
  explains itself and stops instead of POSTing an empty url.

The setup tool hands the hosted URL out by default; set `SAVE_SHORTCUT_URL` in Vercel to
swap in an iCloud link later without code changes. Existing installs don't auto-update —
re-download from your `/setup` page and delete the old copy.

## Kevin's one-time tasks (browser only — can't be done by an agent)

1. **Publish the recipe** with the fields above.
2. **On-device tap-test** the hosted `.shortcut` link once (per the project's hard-won
   lesson: never bake in an install path that hasn't been tap-verified).
3. Optional hardening: set a dedicated `INGEST_TOKEN_SECRET` in Vercel prod (decouples token
   rotation from the MCP shared key). Tokens minted before the change stop working.
  

⚠️ **Retire the old "Save to Poke Setup Guide" PDF** — it hardcodes Kevin's _personal_ Poke user id (a read-credential while `/mcp` list reads key off user-id alone… and every follower of that guide would save into Kevin's list), and its payload section is wrong.
## Evaluated and rejected: "Dynamic iOS Shortcut Injection Service" (2026-06-10)
A proposed Vercel service that downloads a base `.shortcut`, injects each user's credentials into the binary plist, and streams it back for iOS to import. **Not viable on modern iOS — do not build.** Since iOS 15 (2021), `.shortcut` files must be **Apple-signed** to import ("Importing unsigned shortcuts not supported"; the iOS 14 "Allow Untrusted Shortcuts" toggle was removed; the beta-1 bypass was patched). A server-mutated plist is unsigned, and the signature covers the content, so sign-then-inject is impossible; signing per-request requires macOS `shortcuts sign` (or Apple ID keys dumped from a jailbroken device — off-limits). Verified 2026-06-10 against the Shortcuts file-format references and signing tooling docs. The sanctioned equivalent of "injection" is exactly what this recipe already does: per-user value collected once at install via an **Import Question**, identity carried by the `spk_` token.
## Smoke test (no phone needed)
```bash
# 1. Mint a key the way Poke would (user id auto-injected):
curl -s https://poke-amb-bridge.vercel.app/mcp -X POST \
  -H 'content-type: application/json' -H 'x-poke-user-id: <uid>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"setup_save_to_poke","arguments":{}}}'
# 2. Ingest with the returned spk_ key — note: no x-poke-user-id header needed:
curl -s -X POST https://poke-amb-bridge.vercel.app/links/ingest \
  -H 'x-poke-key: <spk_token>' -H 'content-type: application/json' \
  -d '{"url":"https://example.com/spk-smoke"}' -w '\n[%{http_code}]\n'   # expect 201
```
