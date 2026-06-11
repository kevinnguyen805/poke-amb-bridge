# Link Companion — Per-User Auth for Public Multi-User (Design)
- **Date:** 2026-06-10
  
- **Status:** Draft for review
  
- **Owner:** Kevin
  
- **Repo:** `~/dev/poke-amb-bridge` (live: `poke-amb-bridge.vercel.app`)
  
## 1. Summary
Make the published **Link Companion** Poke recipe usable by any member of the public, with each user's saved links **private to them**. Replace the single shared API key — which does **not** distribute to recipe installers — with **per-user OAuth** for the recipe and a **per-user revocable token** for the iOS Shortcut. Both derive identity from a _verified credential_, not a _trusted header_. Kevin's current setup keeps working unchanged (**dual-auth**).
## 2. Why (evidence, not assumption)
Live friend-test (2026-06-10, Vercel logs). A friend installed the recipe; every `/mcp` call arrived as `MCP_REQ a=0 none u=4c542392…`:

- ✅ Poke **auto-injects each user's own** `X-Poke-User-Id` (friend's `4c542392` ≠ Kevin's `0442c7c3`) → per-user scoping _input_ already works natively.
  
- ❌ The published recipe **does not carry the shared API key** → installers send no credential → with `MCP_AUTH_ENFORCE=true`, `list_links`/`save_link` are rejected `-32001`. (That is the "Poke can't pull my links" symptom.)
  

Conclusion: a shared key can't go public. Poke's **official** docs confirm the path: Poke is an MCP host that _"handles the OAuth flow for each user who connects,"_ auto-works with **Dynamic Client Registration (DCR)**, and post-login sends `Authorization: Bearer <per-user-token>`. Official reference for our exact app: `InteractionCo/poke-mcp-examples/bookmark-manager` — _"Remote OAuth + DCR — full multi-user service (WorkOS)."_
## 3. Locked decisions
1. **Per-user isolated lists** (not a shared pool — a shared pool would let any public installer read everyone's saves).
  
2. **Hosted OAuth + DCR via WorkOS** for the recipe (matches the official reference; Kevin is provisioning the account).
  
3. **Dual-auth continuity** — keep Kevin's shared-key + `x-poke-user-id` path working untouched; add OAuth alongside. **No data migration now.**
  
4. **Silent Shortcut** — saves must **not** require opening/texting Poke. The chosen tradeoff is _one-time onboarding setup_ in exchange for _zero per-send friction_. Delivered by a **per-user ingest token** stored in a **signed** iCloud Shortcut via an **Import Question** (paste once at import; signed → no "Allow Untrusted Shortcuts" toggle; silent on every save after).
  
5. **Dynamic-injection service (the zip) is a documented optional follow-on, not v1.** It does **not** reduce onboarding friction — it swaps B's one-time paste for a one-time _"Allow Untrusted Shortcuts"_ security toggle (unsigned shortcuts) — while adding a bplist-mutation service to build + maintain and a secret streamed through a server route. It only becomes worth it if we later want to remove even the single paste.
  
## 4. Architecture
### 4.1 Recipe (MCP) — per-user OAuth
- `/mcp` becomes an OAuth **Protected Resource**: serves `/.well-known/oauth-protected-resource` pointing at **WorkOS AuthKit** as the Authorization Server (DCR-capable).
  
- Flow: user installs the recipe → Poke discovers the PR metadata → DCR registers Poke as a client → Poke runs the per-user authorize flow (AuthKit hosted login: email magic-link + Google) → Poke gets a per-user **access token (JWT)** → sends `Authorization: Bearer <jwt>` on every `/mcp` request.
  
- The server **validates the JWT** (signature via WorkOS JWKS; issuer / audience / expiry) → identity = the token's `sub` (WorkOS user id) → scopes `save_link` / `list_links` / `fetch_link` to that `sub`.
  
### 4.2 Dual-auth resolution (order, per data-tool call)
1. **Valid WorkOS JWT** (`Authorization: Bearer <jwt>`) → `userId = jwt.sub` (public per-user).
  
2. Else **shared key** (`x-poke-key` or `Bearer <POKE_SCOPED_KEY>`) + `x-poke-user-id` → `userId = x-poke-user-id` (Kevin's existing path; stays gated by `MCP_AUTH_ENFORCE`).
  
3. Else → `-32001 unauthorized`.
  

Kevin's existing `0442c7c3` links keep resolving via branch 2 — zero disruption.
### 4.3 Shortcut — per-user ingest token (silent, the B path)
- **Onboarding page** (`/setup`, WorkOS-login-gated — same identity as the recipe): mints a **per-user ingest token** (opaque, revocable, mapped server-side to the user's WorkOS `sub`), shows it (copyable), and offers a one-tap **"Add Save-to-Poke Shortcut"** signed iCloud link. On import, the shortcut's **Import Question** asks the user to paste the token. One time.
  
- **Runtime:** Share → "Save to Poke" → shortcut POSTs `{url, note?, tags?}` to `/links/ingest` with `Authorization: Bearer <ingest_token>` → server looks up the token → resolves to the user's `sub` → saves under that id → `201` + optional "Saved ✓" notification. **No Poke open. No per-save interaction.**
  
- **Token store:** new `ingest_tokens` table `(token_hash, user_id, created_at, revoked_at)`. Hashed at rest; lookup by hash; revocable (lost device → revoke). Reuses the existing `sessionResolver` seam in `core.ts` (swap the `session_<id>` decoder for a DB lookup → `pokeAccountId = sub`).
  
### 4.4 Identity model
`saved_links.poke_user_id` holds the **WorkOS** `sub` for public users. Because the MCP path (JWT) and the Shortcut path (ingest token) both resolve to the same `sub`, a user's recipe saves and shortcut saves land in **one** list. Kevin's rows stay under `0442c7c3` / `6e67a89b` via the shared-key branch (dual-auth; optional later migration).
## 5. Components / files to change
- `api/mcp.ts` — JWT validation (WorkOS JWKS) + dual-auth resolution + per-user scoping from `sub`.
  
- `src/http/core.ts` — extend `sessionResolver` to resolve ingest tokens from the DB → `pokeAccountId = sub`.
  
- `api/.well-known/oauth-protected-resource` — new metadata route.
  
- `api/setup` (+ minimal page) — WorkOS-login-gated onboarding: mint + show the ingest token and the shortcut link.
  
- `src/links/store.ts` — `ingest_tokens` table + mint / lookup / revoke helpers.
  
- `src/config.ts` — WorkOS env (issuer, JWKS URL, audience, client config) + feature flags.
  
- A new **signed iCloud Shortcut** authored in the Shortcuts app with an Import Question for the token (Kevin creates + shares it from the phone; I provide the exact action list).
  
## 6. Error handling
- Invalid / expired / wrong-audience JWT → `-32001` (recipe) / `401` (HTTP).
  
- Revoked or unknown ingest token → `401` at `/links/ingest`.
  
- WorkOS/JWKS fetch failure → **fail closed** (reject); cache JWKS with a TTL so edge requests don't fetch per-call.
  
- Unchanged: rate limits, URL validation (http/https, ≤2048), store-failure `503`.
  
## 7. Testing
- **Unit:** JWT validation (valid / expired / bad-sig / bad-aud); ingest-token mint → lookup → revoke; dual-auth resolution order; **isolation** (user A cannot read user B's links).
  
- **Integration:** simulated public user (JWT) saves + lists only their own; Kevin's shared-key path unaffected; Shortcut token → `/links/ingest` → correct `sub` bucket.
  
- **Live:** re-run the friend-test under OAuth — friend logs in, saves, lists their own; confirm via logs (`a=1`, per-user `sub`) and DB rows under the friend's `sub`.
  
## 8. Security
- Per-user, **revocable** credentials only; **no shared secret distributed to the public**.
  
- JWT verified against WorkOS JWKS every request (cached); `x-poke-user-id` is trusted **only** in Kevin's gated shared-key branch, never for public users.
  
- Ingest tokens hashed at rest; treated as device secrets (revoke on loss).
  
- **No credentials in URLs/query-params** (explicitly avoiding the injection doc's `?api_key=` anti-pattern, which logs secrets in Vercel/proxies/history).
  
## 9. Non-goals / follow-ons
- Migrating Kevin's existing `0442c7c3` links onto his WorkOS identity.
  
- Retiring the shared key once everyone is on OAuth.
  
- The **dynamic-injection Shortcut** (removes the one-time paste; needs unsigned-shortcut handling + the injector).
  
- Polished / branded onboarding UI.
  
## 10. What I need from Kevin (build-time)
- WorkOS account → AuthKit configured (email magic-link + Google) + **API keys / issuer / JWKS URL / audience** set as Vercel env vars.
  
- Confirm "email magic-link + Google" as sign-in methods (or adjust).
  
- Author the signed iCloud Shortcut with the Import Question (I provide the exact action list; shortcut authoring is on-device).
  
## 11. To verify at implementation
- WorkOS AuthKit **DCR** specifics + the exact PR-metadata shape Poke expects (confirm against the bookmark-manager reference + a live connect test).
  
- Edge-runtime JWT verification (e.g. `jose`) + JWKS caching pattern on Vercel edge.
