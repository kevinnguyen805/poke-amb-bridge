# "Save to Poke" — recipe kit

A Poke recipe + iOS Shortcut pair: share any link from any app → it lands silently in your
Link Companion list. **Setup is one chat message + one paste** — no API-key hunting, no
endpoint URLs, no user-id handling.

## The end-user experience (what we optimized for)

1. **Install the recipe** → it opens with the prefilled first message.
2. Poke calls `setup_save_to_poke` and replies with your **personal save key** + the Shortcut
   link.
3. **Tap the Shortcut link, paste the key when asked.** Done — share sheet → "Save to Poke"
   from then on.

The user never sees an endpoint URL, never edits headers, never learns what a user id is.

## How it works (server side, already live)

- New MCP tool **`setup_save_to_poke`** (in `api/mcp.ts`) — deliberately **open** (not behind
  `MCP_AUTH_ENFORCE`): the friend-test proved public-recipe installers arrive with *no* API
  key but Poke always auto-injects their own `X-Poke-User-Id`. The chat is therefore the one
  place the server can learn who the user is, so the recipe itself provisions the credential.
- The tool mints a **self-authenticating, write-only token**:
  `spk_<base64url(userId)>.<HMAC-SHA256(secret, userId) truncated>` (`src/links/ingestToken.ts`).
  No key table, no migration; same user → same token (re-running setup is idempotent).
  Secret = `INGEST_TOKEN_SECRET`, falling back to `POKE_SCOPED_KEY`.
- **`POST /links/ingest`** accepts `x-poke-key: spk_…` and derives the user **from the token**
  (a spoofed `x-poke-user-id` header is ignored on this path). The legacy shared-key + header
  path still works, so Kevin's existing Shortcut install is untouched.

### Security model (why an open mint is safe)

- The token is accepted **only** by `/links/ingest` — it can never read links, so the open
  mint can't leak data.
- Worst case, someone who already *knows* a victim's Poke user id (unguessable UUID) can mint
  a token and **add** links to that victim's list — same exposure class the project already
  carries, now bounded write-only and rate-limited (60/min/IP on ingest).
- Per-user revocation doesn't exist (token is derived, not stored); rotation is global via
  `INGEST_TOKEN_SECRET`. Accepted for this tier — escalate to stored per-user tokens or MCP
  OAuth if/when that matters.

## Recipe fields (publish at poke.com — browser, not CLI; `poke mcp add` hangs headless)

| Field | Value |
|---|---|
| Name | `Save to Poke` |
| Tagline | `Share any link from any app — it lands in your Poke list, silently.` |
| Integration | the existing Link Companion MCP (`https://poke-amb-bridge.vercel.app/mcp`) — **leave API Key empty**; setup doesn't need it |
| Prefilled first message (USER voice) | `Set up Save to Poke for me — I want to save links from my phone's share sheet.` |
| Input context | *(leave blank — the tool gets everything from the auto-injected user id)* |

Reminder from the Link Companion launch: only `prefilledFirstText` starts the chat;
behavioral framing already lives in the MCP `instructions` (updated to route setup asks to
`setup_save_to_poke` and to relay the key verbatim).

## Kevin's one-time tasks (device/browser only — can't be done by an agent)

1. **Republish the Shortcut with an Import Question** (~5 min, iPhone or macOS Shortcuts):
   - Open the existing "Save to Poke" shortcut → make sure the `Get Contents of URL` action
     posts to `https://poke-amb-bridge.vercel.app/links/ingest` with **one** header:
     `x-poke-key`. **Delete the `x-poke-user-id` header** — spk keys identify the user.
   - Add an **Import Question** on the `x-poke-key` header value: shortcut settings (ⓘ) →
     *Import Questions* → select that parameter → prompt: `Paste your Save to Poke key
     (ask Poke: "set up Save to Poke")`.
   - Body stays JSON: `url` = the shared URL (plus optional `note`/`tags`). The old setup
     guide PDF's `text`/`prefix: "POKE:"` fields were a Poke confabulation — the real
     contract is `url`/`note`/`tags` (see `SHORTCUT.md` §1).
   - Share → **Copy iCloud Link** → set it as `SAVE_SHORTCUT_URL` in Vercel
     (`vercel env add SAVE_SHORTCUT_URL production`) + redeploy, or tell the agent the link.
     Until then the tool hands out the old link with fallback edit-the-header instructions,
     so the flow works either way.
2. **Publish the recipe** with the fields above.
3. Optional hardening: set a dedicated `INGEST_TOKEN_SECRET` in Vercel prod (decouples token
   rotation from the MCP shared key). Tokens minted before the change stop working.

⚠️ **Retire the old "Save to Poke Setup Guide" PDF** — it hardcodes Kevin's *personal* Poke
user id (a read-credential while `/mcp` list reads key off user-id alone… and every follower
of that guide would save into Kevin's list), and its payload section is wrong.

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
