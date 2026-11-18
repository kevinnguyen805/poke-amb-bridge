As of 2026-11-17 · default branch main @ 3dca8c6 (2026-06-10)

# poke-amb-bridge: hand-off

## What this is
One repo, two projects, both for Poke (an AI assistant you talk to over iMessage, poke.com):
1. **Tier-1 "one-channel" spine** (2026-06-06, now dormant): a reference implementation that links a user's iMessage identity and their Apple Messages for Business (AMB) Opaque ID into one Poke conversation using single-use share tokens. Apple and MSP boundaries are mocked (`LoggingMsp`). Code: `src/spine/*`, `api/share.ts`, `api/amb/ingress.ts`, `api/vcard.ts`, `api/wallet.ts`, `api/open.ts`.
2. **Link Companion + "Save to Poke"** (2026-06-08 to 06-10, the live product): an MCP server Poke calls to save, list and read links per Poke user, plus an Apple-signed iOS Shortcut that saves links from the share sheet. Code: `api/mcp.ts`, `api/setup.ts`, `api/links/ingest.ts`, `src/links/*`, `public/save-to-poke.shortcut`, `scripts/build-shortcut.py`.

Stack: TypeScript, Vercel Edge functions, Neon Postgres (HTTP driver), Web Crypto, vitest, pg-mem. Public repo. Live: https://poke-amb-bridge.vercel.app (MCP at `/mcp`). Recipes: Link Companion https://poke.com/r/af3fh3EA9B_ (MANUAL.md); Save to Poke https://poke.com/r/w_S3K1zll9V (RECIPE-SAVE-TO-POKE.md, was a draft rendering "Recipe Not Found" as of 2026-06-10).

Relation to other repos: poke-conduit (2026-06-18) reused this repo's choices (hand-rolled JSON-RPC, edge runtime) and its DEPLOY.md suggests sharing this repo's Neon database. No relation to imsg-mcp is stated.

## Run, test, deploy
| Task | Command |
|---|---|
| Install | `npm install` (CI uses `npm ci`, Node 20. Node 22 also passes) |
| Test | `npm test` (`vitest run`, 18 files, about 112 cases by grep count. README's "51 tests" is stale) |
| Typecheck | `npm run typecheck` |
| Spine demo | `npm run demo` (narrates the 4 spine user flows) |
| Local server | `npm run serve` (`node:http` on :7400, spine routes plus `/links/ingest`) |
| Prod smoke test | `scripts/accept-cold-install.sh [expected-shortcut-sha256]` (15 checks, hits PROD with a random uid) |
| Rebuild Shortcut | `python3 scripts/build-shortcut.py /tmp/stp-unsigned.shortcut` then `shortcuts sign -m anyone -i /tmp/stp-unsigned.shortcut -o public/save-to-poke.shortcut` (macOS only) |
| Deploy | Push to `main`: GitHub Actions runs typecheck + test, Vercel auto-deploys (DESIGN-SPEC §8) |

Env vars read by code (names only): `DATABASE_URL` (or `POSTGRES_URL`, `DATABASE_URL_UNPOOLED`), `POKE_SCOPED_KEY`, `INGEST_TOKEN_SECRET`, `MCP_AUTH_ENFORCE`, `SAVE_SHORTCUT_URL`, `MSP_SECRET`, `POKE_BUSINESS_UUID`, `POKE_IMESSAGE_NUMBER`, `POKE_PASS_TYPE_ID`, `POKE_TEAM_ID`, `PORT`. PRODUCTION.md also lists `MSP_API_BASE`, `MSP_API_KEY`, `HANDLE_ENC_KEY`, `NODE_ENV`; these are not read by the code yet.

External services: Vercel (project `poke-amb-bridge`), Neon Postgres (tables `saved_links`, spine tables, rate-limit table; migrated lazily), Poke (poke.com Kitchen recipes, MCP connections), Apple Shortcuts signing (Kevin's Mac).

MCP tools (5): `get_share_shortcut`, `setup_save_to_poke`, `save_link`, `list_links`, `fetch_link`. Other routes: `/healthz`, `/setup`, `/links/ingest`, `/share`, `/amb/ingress`, `/vcard`, `/open`, `/wallet`, `/save-to-poke.shortcut`.

## Where it was left off
Last work: 2026-06-10 (Pacific), a burst of Save to Poke fixes driven by the first real outside installer. Final commit 3dca8c6 fixed onboarding copy (success is a vibration, not a banner). CI on main last ran 2026-06-11 at 3dca8c6: success.

Works (per commits and docs, verified live at the time):
- Link Companion tools against Neon, scoped by Poke's injected `x-poke-user-id`.
- Save to Poke: `setup_save_to_poke` mints an `spk_` token, `/setup?k=` page shows copy button and Shortcut download, Shortcut v2.2 posts to `/links/ingest`. Cold-installer script passed 15 checks against prod (a995930).
- Spine: verified in prod on 2026-06-06 (bound, replay, foreign-reject, cold, CAS, HMAC) per README. MSP is logging-only.

Open or half-done:
- Save to Poke recipe publish in Kitchen: must be done in a browser by Kevin. Unknown whether done.
- On-device tap test of the hosted `.shortcut`: listed as a Kevin task. v2 and v2.2 commits describe real-device failures and fixes, so device testing happened. Whether v2.2 was confirmed on device is unknown.
- `INGEST_TOKEN_SECRET` in prod: optional hardening. Unknown whether set.
- Retire the old "Save to Poke Setup Guide" PDF, which hardcodes Kevin's personal Poke user id (RECIPE-SAVE-TO-POKE.md). Unknown whether done. The PDF is not in the repo.
- Reader-mode `fetch_link` sits unmerged on `feat/fetch-link-extraction`.
- Per-user OAuth spec (WorkOS) is a draft. Not started in code.

## History and decisions
| Date | Decision or milestone | Why | Source |
|---|---|---|---|
| 2026-11-17 | Lockfile-only audit-fix PR #2 (c4/h25/m7 to c3/h15/m4). Dependabot PR #1 (hono). Dependabot security jobs for `undici` and `@hono/node-server` failed with `security_update_not_possible` | Account-wide security pass. No malware or compromise found | PR #2 body, `gh run list` |
| 2026-06-10 | Onboarding copy says success is a vibration, tests reject any "Saved" banner promise | Silent success otherwise looks like failure | 3dca8c6 |
| 2026-06-10 | First-run usage guidance in setup tool result, MCP instructions and `/setup` | Users learned how to install but not what to do next | 6b480a2 |
| 2026-06-10 | Cold-installer acceptance script against prod | Reproduce a brand-new installer journey without a second phone | a995930 |
| 2026-06-10 | MCP instructions carry verified troubleshooting facts; Shortcut and `/setup` show a version marker | Poke invented false error stories for installers; stale installs must be diagnosable | 271c8e7 |
| 2026-06-10 | Shortcut v2.2: item-input slots use flat `WFTextTokenAttachment`; build script self-checks encodings | v2 imported with unwired slots, "url has no value" at runtime | 8b41a49 |
| 2026-06-10 | Instructions forbid handing out the old iCloud "Message Poke" shortcut for Save to Poke setup | Installers got the old shortcut instead of the setup flow | b308937 |
| 2026-06-10 | Keyless installers: injected `x-poke-user-id` counts as the MCP credential for data tools; `-32001` only when no key and no uid | `-32001` wedged Poke into a needs-authorization loop (authorize link 500s, re-add says "invalid url"). Accepted trade-off: a leaked uid reads that user's list | 4de86b7, RECIPE-SAVE-TO-POKE.md "MCP auth for recipe installers" |
| 2026-06-10 | Shortcut v2: editor-native input wiring, no-input guard, success only on `{saved}` | v1 showed "Saved" even on a 400 | 2459063 |
| 2026-06-10 | Programmatic recipe publish declared a dead end | `create-recipe` ignores all fields but `name`; recipe read endpoint 403s for CLI tokens; Kitchen uses browser-session auth | 6041914, RECIPE-SAVE-TO-POKE.md |
| 2026-06-10 | `setup_save_to_poke` returns a `/setup?k=` link, not a raw key | Poke would not relay the key verbatim; chat UI has no copy; URLs are kept intact | dac5f1a |
| 2026-06-10 | Rejected a "dynamic shortcut injection" service | Since iOS 15, shortcuts must be Apple-signed; a server-mutated plist is unsigned | 4829802, RECIPE-SAVE-TO-POKE.md |
| 2026-06-10 | Host an Apple-signed Shortcut with an Import Question at `/save-to-poke.shortcut` | Zero device work to distribute | 80c450f |
| 2026-06-10 | Self-authenticating write-only `spk_` tokens: `spk_<b64url(uid)>.<truncated HMAC>`, no key table | One-paste onboarding; stateless; same user gets same token. No per-user revocation, global rotation only | 5e2235d |
| 2026-06-10 | Per-user OAuth design (WorkOS AuthKit + DCR, dual-auth, stored hashed ingest tokens) drafted | Friend test: recipe installers send no API key, so a shared key cannot go public | docs/superpowers/specs/2026-06-10-link-companion-per-user-auth-design.md |
| 2026-06-10 | `POKE_SCOPED_KEY` set in prod; `pk_shortcut_demo` stops working in prod | Close `/links/ingest` to anyone without the real key | SHORTCUT.md §5 |
| 2026-06-10 | Diagnostic auth logging in one front-loaded `MCP_REQ` line; data-tool gate behind `MCP_AUTH_ENFORCE` (default off) | Vercel log viewer shows only the first line; ship diagnostics before rejecting | f4e210e, 7e8927c |
| 2026-06-09 | `POST /links/ingest` for Shortcut saves into `saved_links` | Save without routing through Poke's MCP path | 897d055 |
| 2026-06-09 | SSE-framed responses when `Accept: text/event-stream`; GET SSE returns 405 | Poke reported generic failures while every request returned 200: transport framing bug | e3334e4, DESIGN-SPEC §9.5 |
| 2026-06-09 | Onboarding `instructions` in MCP `initialize` | Behavior travels with the server regardless of recipe config | a7cb918, DESIGN-SPEC §9.4 |
| 2026-06-08 | Link Companion MCP as hand-written JSON-RPC, no SDK | Node-only MCP SDK `FUNCTION_INVOCATION_FAILED` on edge runtime | 66a9f17, DESIGN-SPEC §9.1 |
| 2026-06-06 | Rate limiting (`/share` 30/min/IP) and doorways: vCard, unsigned Wallet `pass.json`, `/open` redirect | Entry points to the bcrw link | 1d13806 |
| 2026-06-06 | Neon HTTP driver `neon()`, not WebSocket Pool | Cached Pool went stale across invocations; 2nd query hung 30 s | bbf5031 |
| 2026-06-06 | Edge runtime + Web Crypto for all `/api` functions | Default Node runtime ignored Web Request/Response handlers (every call 500'd) | 6a1f7c4 |
| 2026-06-06 | Async stores, Postgres adapter with SQL compare-and-set, Vercel deploy chosen over container | PRODUCTION.md: serverless needs an external store; Vercel matches Kevin's stack | fd3384c, PRODUCTION.md |
| 2026-06-06 | Tier-1 spine: base62 tokens, two token classes (anonymous vs account-bound with consent), CAS single-use, egress chokepoint (AI label, human escalation, 24 h window) | From the plan at `~/poke-one-channel-bridge-plan.md` (not in the repo) | 240c24e, README |

## In-flight work
| Branch | PR | Ahead / behind main | Contents | State |
|---|---|---|---|---|
| `feat/fetch-link-extraction` | none | 1 ahead / 5 behind (forked at b308937) | d91988a (2026-06-10): reader-mode `fetch_link`: `<article>`/`<main>` extraction, paragraph breaks, full entity decode, page title prefix, IPv6 SSRF blocks, skip non-text types. Touches only `src/links/fetch.ts` and new `test/links-fetch.test.ts` (16 tests) | Never merged, no PR. Main has not touched those files since the fork, so it should rebase cleanly (not tested) |
| `security/npm-audit-fix` | #2 open | 1 ahead / 0 behind | Lockfile only | CI green. Verified on Node 22 |
| `dependabot/npm_and_yarn/hono-4.13.19` | #1 open | 1 ahead / 0 behind | hono 4.12.24 to 4.13.19, lockfile only | CI green |
#1 and #2 both edit `package-lock.json`; merge one, then rebase the other.

## Planned next steps
| Item | Source | Status |
|---|---|---|
| Per-user OAuth via WorkOS AuthKit + DCR, `/.well-known/oauth-protected-resource`, JWT validation with `jose`, `ingest_tokens` table, login-gated `/setup` | 2026-06-10 auth design spec (Draft) | Not started. No WorkOS, jose or well-known route in code. The Shortcut half was delivered differently: stateless HMAC `spk_` tokens instead of a stored, revocable token table |
| Publish Save to Poke recipe in Kitchen; tap-test hosted Shortcut on device; set `INGEST_TOKEN_SECRET`; retire old PDF guide | RECIPE-SAVE-TO-POKE.md "Kevin's one-time tasks" | Unknown (browser and device tasks, no repo trace) |
| Reader-mode `fetch_link` | DESIGN-SPEC §10 ("returns raw stripped text") | Done on `feat/fetch-link-extraction`, not merged |
| DNS-resolving SSRF guard | DESIGN-SPEC §7 ("noted for hardening") | Not started. Branch adds IPv6 patterns only |
| Dedup saved links; delete/edit tool | DESIGN-SPEC §10 | Not started |
| Store `source` provenance; text-only shares | SHORTCUT.md §6 | Not started |
| Real MSP adapter; `HANDLE_ENC_KEY` field encryption; log scrubbing; readiness vs liveness; per-linkSource breaker and metering | PRODUCTION.md hardening checklist | Not started. Rate limit and CI items are done (1d13806, 388afc6). Durable store done (fd3384c) |
| Spine launch gates 0 (on-device bcrw) and 1 (legal OK for opaqueID to handle correlation); Poke Business UUID, MSP contract | PRODUCTION.md, README "Deferred" | External, not started. Spine is called "dormant" in DESIGN-SPEC §10 |
| Signed `.pkpass`, AASA + Smart Banner | README "Deferred" | Not started. `/wallet` serves unsigned `pass.json` only |

## Gotchas
- **Demo key fallback.** `POKE_SCOPED_KEY` defaults to the public string `pk_shortcut_demo` in `src/config.ts`, `src/serve.ts`, `api/mcp.ts`, `api/setup.ts`, and `INGEST_TOKEN_SECRET` falls back to it. Any environment without `POKE_SCOPED_KEY` set (for example a new Vercel preview or project) accepts the public key and lets anyone forge `spk_` tokens. Prod has it set per SHORTCUT.md. The string in `public/index.html` and tests is not a live secret.
- **Poke user ids are read-credentials.** `list_links` trusts the injected `x-poke-user-id`. Never commit a real Poke user id (SHORTCUT.md §4). The repo is public with secret scanning and push protection on as of 2026-11-17.
- **No MCP SDK on edge.** `@modelcontextprotocol/sdk` and `@vercel/node` are in `dependencies` but no file in `api/`, `src/` or `test/` imports them. They only add audit noise. Do not "refactor to the SDK".
- **SSE framing is required** for Poke. Plain JSON 200s show up in Poke as generic failures.
- **Do not return `-32001` to recipe installers**: it wedges Poke's client. Keep the uid-as-credential rule unless OAuth ships.
- **Shortcut plist encodings differ per slot type** (text vs item-input vs If). Wrong encoding imports cleanly but leaves slots unwired. Always rebuild with `scripts/build-shortcut.py` and sign on macOS. Existing installs never auto-update.
- **Programmatic Kitchen publish does not work.** Don't re-probe (RECIPE-SAVE-TO-POKE.md).
- `npx poke mcp add` hangs without a TTY. Run it interactively or use poke.com/integrations/new (MANUAL.md).
- Vercel log viewer shows only the first line per request; keep diagnostics on one front-loaded line.
- Docs reference `~/dev/poke-amb-bridge` and `~/poke-one-channel-bridge-plan.md` on the old laptop. There is no local working copy now; the plan file is not in the repo and may be lost.
- Dependabot security updates for `undici` and `@hono/node-server` (transitive) fail with `security_update_not_possible`. They need a parent bump by hand.
- `accept-cold-install.sh` writes to the PROD database under a random uid.

## Sources
- Files on main: README.md, DESIGN-SPEC.md, MANUAL.md, PRODUCTION.md, RECIPE-KIT.md, RECIPE-SAVE-TO-POKE.md, SHORTCUT.md, docs/superpowers/specs/2026-06-10-link-companion-per-user-auth-design.md, package.json, vercel.json, .github/workflows/ci.yml, src/config.ts (head), api/mcp.ts (grep), src/spine/pkpass.ts (head), scripts/accept-cold-install.sh (head)
- Commit log (34 commits) and bodies of 1d13806, fd3384c, bbf5031, 6a1f7c4, 66a9f17, e3334e4, 897d055, 5e2235d, 80c450f, dac5f1a, 4de86b7, 8b41a49, 271c8e7, f4e210e, b308937, 2459063, a995930, 6b480a2, 3dca8c6, d91988a
- Branches: `feat/fetch-link-extraction`, `security/npm-audit-fix`, `dependabot/npm_and_yarn/hono-4.13.19` (ahead/behind, diff stat)
- PRs #1, #2 (bodies); `gh run list` (CI and Dependabot runs); Dependabot run 44183009347 log
- greps: env var names, `pk_shortcut_demo`, SDK imports, TODO/FIXME (none)
