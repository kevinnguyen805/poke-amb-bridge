# Poke One-Channel Bridge — Tier-1 spine (reference implementation)

A runnable, fully-tested TypeScript reference implementation of the **Tier-1 spine** that makes
Poke feel like a single conversation across **iMessage** and **Apple Messages for Business (AMB)** —
two distinct Apple-side identities — with **zero Apple cooperation** required for the core.

It implements the load-bearing logic from the implementation plan
(`~/poke-one-channel-bridge-plan.md`): the token mint, the AMB ingress resolution, and the AMB
egress middleware, plus the in-memory stores and the CAS single-use primitive.

> **What this is / isn't.** This is a reference implementation — the kind you'd demo or hand to an
> eng team, not a production integration. The **MSP and Apple boundaries are mocked** (`MockMsp`),
> state is in-memory, and the two launch gates from the plan (on-device bcrw routing; correlation-
> consent legality) are out of scope here by design.

## Live

Deployed on **Vercel** (Edge functions) + **Neon Postgres**: https://poke-amb-bridge.vercel.app

```
GET  /healthz
POST /share        (header x-poke-key)
POST /amb/ingress  (header x-msp-signature: hmac-sha256 over the raw body)
```

Verified in production across separate serverless invocations: `bound` / `replay` / `foreign-reject` /
`cold` resolution, token single-use (CAS), and HMAC auth — all persisting through Postgres. The MSP
boundary is the `LoggingMsp` (emits to platform logs); it flips to a real MSP when credentials exist
(see `PRODUCTION.md`).

## Run it

```bash
npm install
npm test        # 51 tests across 8 files
npm run typecheck
npm run demo    # narrates the four User Flows end to end
npm run serve   # boots the bridge as an HTTP service on :7400
```

The running service exposes exactly the two surfaces the real flow hits:

```
POST /share        # the Shortcut/web calls this (header: x-poke-key)   → { token, bcrwUrl, ... }
POST /amb/ingress  # the MSP webhook calls this (header: x-msp-signature: hmac-sha256)
GET  /healthz
```

## Architecture (the spine)

```
 entry points          mint                bcrw Universal Link            ingress (CAS)         egress
 ────────────       ───────────         ───────────────────────       ───────────────       ────────────
 Shortcut  ─┐                           bcrw.apple.com/urn:biz:<UUID>                          sendAmb()
 vCard      ├─▶  POST /share  ─▶  token  ?biz-intent-id=<intent>  ─▶  resolve(opaqueId, ─▶  • AI-label
 QR / NFC   │   (mint.ts)      (base62)  &body=poke%3A<token>          body)                 • human escalate
 Wallet     │                            (bcrw.ts)                     (ingress.ts)          • 24h window
 web        ┘                            user taps Send (no auto-send)  ├ CAS single-use     • circuit breaker
                                                                        ├ gated account bind  (egress.ts)
                                                                        └ route → sendAmb
```

The **token lifecycle** is the connective tissue: `/share` mints a short-lived, class-typed token →
the Shortcut/web embeds it in the bcrw `body` → the user taps Send → ingress resolves it on the first
inbound AMB message, links the AMB **Opaque ID** (and, only via a consented account-bound token, the
Poke account), and routes the reply through the egress chokepoint.

## Module map → plan deliverables

| File | Responsibility | Plan |
|---|---|---|
| `src/spine/token.ts` | base62 22-char CSPRNG token codec + anchor regex | spine |
| `src/spine/bcrw.ts` | canonical bcrw URL builder (percent-encode, never strip) + `sms:open` plan-B | VL-1 |
| `src/spine/types.ts` | data model (`ShareTokenRecord`, `ContinuityLink`, …) — single source of field names | spine |
| `src/spine/store.ts` | in-memory `SHARE_TOKENS` (with **CAS** `consume`) + `CONTINUITY` | spine |
| `src/spine/mint.ts` | `POST /share` — token-class derivation, **no caller-asserted handle**, consent gate | T1-D1 |
| `src/spine/ingress.ts` | deterministic 6-branch resolution + CAS single-use + gated binding + routing | T1-D2 |
| `src/spine/egress.ts` | `sendAmb` chokepoint — label + real human escalation + 24h window + breaker | T1-D2e |
| `src/spine/msp.ts` | the mocked MSP boundary (`MockMsp`) | ASSUMPTION-A2 |
| `src/http/server.ts` | thin HTTP transport: `/share`, `/amb/ingress` (HMAC), `/healthz` | T1 transport |

## Security & correctness properties (each has tests)

- **Two token classes.** `anonymous` (Shortcut/public key, never binds an account) vs `account-bound`
  (session + logged consent, server-stamps the account). `handle` is never accepted from the request.
- **Single-use is compare-and-set.** A consumed token presented by a *different* Opaque ID is
  rejected (`foreign-reject`) — no replay, no merge, no takeover. Concurrent delivery → exactly one bind.
- **Gated binding.** An account is bound only by an `account-bound` token with a valid `consentRef`.
- **Idempotent on Opaque ID** (VL-2: keyed to the Apple Account), with an authenticated re-link path
  reserved for the "same human, new Opaque ID" case (never an auto-merge).
- **Egress is a chokepoint.** Every outbound — including degraded/cold/error replies — is AI-labeled,
  carries a real human-escalation control, and is hard-blocked past the 24h window (`alwaysReplyOnAMB`
  cannot override). Unlabeled or out-of-window egress is structurally impossible.
- **PII minimization.** The KV token store holds no raw phone/Apple-ID; the encrypted handle lives
  only in `CONTINUITY`.

## Deferred (next increments)

- Leaf generators: hybrid vCard, Wallet `.pkpass`, AASA + Smart Banner, the Shortcut action graph
  (independent distribution artifacts — not the core linking loop).
- A real MSP adapter to replace `LoggingMsp` — gated on an MSP contract (see `PRODUCTION.md`).
- The two launch gates (on-device bcrw smoke test; correlation-consent legality) — see the plan.
