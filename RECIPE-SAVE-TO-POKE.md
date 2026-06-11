# "Save to Poke" — recipe kit
A Poke recipe + iOS Shortcut pair: share any link from any app → it lands silently in your Link Companion list. **Setup is one chat message + one paste** — no API-key hunting, no endpoint URLs, no user-id handling.
## The end-user experience (what we optimized for)
1. **Install the recipe** → it opens with the prefilled first message.
  
2. Poke calls `setup_save_to_poke` and replies with your **personal save key** + the Shortcut link.
  
3. **Tap the Shortcut link, paste the key when asked.** Done — share sheet → "Save to Poke" from then on.
  

The user never sees an endpoint URL, never edits headers, never learns what a user id is.
## How it works (server side, already live)
- New MCP tool `setup_save_to_poke` (in `api/mcp.ts`) — deliberately **open** (not behind `MCP_AUTH_ENFORCE`): the friend-test proved public-recipe installers arrive with _no_ API key but Poke always auto-injects their own `X-Poke-User-Id`. The chat is therefore the one place the server can learn who the user is, so the recipe itself provisions the credential.
  
- The tool mints a **self-authenticating, write-only token**: `spk_<base64url(userId)>.<HMAC-SHA256(secret, userId) truncated>` (`src/links/ingestToken.ts`). No key table, no migration; same user → same token (re-running setup is idempotent). Secret = `INGEST_TOKEN_SECRET`, falling back to `POKE_SCOPED_KEY`.
  
- `POST /links/ingest` accepts `x-poke-key: spk_…` and derives the user **from the token** (a spoofed `x-poke-user-id` header is ignored on this path). The legacy shared-key + header path still works, so Kevin's existing Shortcut install is untouched.
  
### Security model (why an open mint is safe)
- The token is accepted **only** by `/links/ingest` — it can never read links, so the open mint can't leak data.
  
- Worst case, someone who already _knows_ a victim's Poke user id (unguessable UUID) can mint a token and **add** links to that victim's list — same exposure class the project already carries, now bounded write-only and rate-limited (60/min/IP on ingest).
  
- Per-user revocation doesn't exist (token is derived, not stored); rotation is global via `INGEST_TOKEN_SECRET`. Accepted for this tier — escalate to stored per-user tokens or MCP OAuth if/when that matters.
  
## Recipe fields (publish at poke.com — browser, not CLI; `poke mcp add` hangs headless)
| Field | Value |
| --- | --- |
| Name | `Save to Poke` |
| Tagline | `Share any link from any app — it lands in your Poke list, silently.` |
| Integration | the existing Link Companion MCP (`https://poke-amb-bridge.vercel.app/mcp`) — **leave API Key empty**; setup doesn't need it |
| Prefilled first message (USER voice) | `Set up Save to Poke for me — I want to save links from my phone's share sheet.` |
| Input context | _(leave blank — the tool gets everything from the auto-injected user id)_ |

Reminder from the Link Companion launch: only `prefilledFirstText` starts the chat; behavioral framing already lives in the MCP `instructions` (updated to route setup asks to `setup_save_to_poke` and to relay the key verbatim).
## The Shortcut (SOLVED — signed + hosted, no device work needed)

The import-question Shortcut was **authored programmatically and Apple-signed on Kevin's Mac**
(`shortcuts sign -m anyone` — signed files import fine on iOS 15+; only *unsigned* ones are
blocked). It's hosted at **`https://poke-amb-bridge.vercel.app/save-to-poke.shortcut`**
(served `application/x-apple-as-shortcut`; source plist structure: Text action holding the
key → Get URLs from Input → POST `/links/ingest` with one `x-poke-key` header → "Saved ✓"
banner; one Import Question on the Text action). The setup tool hands this URL out by
default; set `SAVE_SHORTCUT_URL` in Vercel to swap in an iCloud link later without code
changes. **Verify on-device once**: tap the link in Safari → open the download → Shortcuts
should preview it and ask for the key. Rebuild + re-sign: `shortcuts sign -m anyone -i
<unsigned> -o public/save-to-poke.shortcut` (authoring script in the session transcript /
re-derivable from this structure).

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
