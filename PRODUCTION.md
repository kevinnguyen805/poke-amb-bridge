# Path to production

This service is the **linking spine** of the bridge. Taking it to "working prod" has two
distinct halves: the part **fully in our control** (build it, harden it, deploy it, make it
correct and credential-ready) and the part **gated on external access** (real Apple/AMB traffic).
Being precise about the seam is the point of this doc.

## What "working prod" means here

| Definition | Achievable from here? | Why |
|---|---|---|
| Deployed, durable, hardened HTTPS service exposing `/share` + `/amb/ingress` + `/healthz`, correct under load, wired to flip on with real credentials | **Yes** | All code + infra we own |
| That service processing **real** iMessage/AMB messages from real users | **No — externally gated** | Needs Poke's Apple Business Register account, an MSP contract, a registered iMessage number, and the two launch gates cleared |

We can build and deploy the first row now. The second row flips on when the prerequisites below exist.

## External prerequisites (NOT buildable from code)

| Prerequisite | Who provides it | Needed for |
|---|---|---|
| `POKE_BUSINESS_UUID` (registered AMB Business ID) | Apple Business Register, via Poke | the `urn:biz:` target every bcrw URL points at |
| Apple-approved **MSP** account + AMB REST API creds | a paid MSP contract (LivePerson / Infobip / Genesys / …) | sending replies + receiving the `/amb/ingress` webhook |
| Registered **iMessage business number** | Poke telephony + MSP | the iMessage side of the bridge (T1-D6 consent CTA) |
| **LAUNCH GATE 0** — on-device confirmation that `Open URLs → bcrw` reaches the AMB thread | a physical iPhone test | the whole Tier-1 entry path (fallback: `sms:open?…`) |
| **LAUNCH GATE 1** — legal sign-off that the MSP/Apple agreement permits opaqueID↔handle correlation | the MSP/Apple contract review | any account binding (anonymous path works regardless) |

Until these exist, the service runs against the **mocked MSP boundary** (`MockMsp`) — fully exercising
the spine, just not real Apple traffic.

## Production architecture (what we build)

```
HTTPS ─▶ /share        ─▶ mint   ─┐
        /amb/ingress   ─▶ resolve ─┼─▶  DURABLE STORE (replaces InMemory*)   ─▶  REAL MSP ADAPTER
        /healthz                  ─┘     (SHARE_TOKENS: TTL+CAS; CONTINUITY)      (replaces MockMsp)
                                          + field-encryption on handleEnc          send() / webhook
```

Three swaps turn the reference impl into prod — all behind the seams already in the code:

1. **Durable store** behind a `TokenStore` / `ContinuityStore` interface. Serverless is stateless,
   so an external store is mandatory. The CAS becomes `UPDATE share_tokens SET consumed_at=…,
   consumed_by=… WHERE token=$1 AND consumed_at IS NULL` (one-row-changed = winner). Field-encrypt
   `handle_enc`. Methods go **async**.
2. **Real MSP adapter** implementing `Msp.send` / `routeToHuman` against the chosen MSP's REST API,
   plus HMAC verification of its webhook (already in `/amb/ingress`).
3. **Config from env / secrets** (below) — no demo defaults in prod.

## Environment variables

| Var | Purpose |
|---|---|
| `POKE_BUSINESS_UUID` | AMB Business ID |
| `POKE_SCOPED_KEY` | the Shortcut's public `/share` key (anonymous-mint-only, rotateable) |
| `MSP_SECRET` | HMAC key the MSP signs `/amb/ingress` with |
| `MSP_API_BASE` / `MSP_API_KEY` | real MSP send credentials |
| `DATABASE_URL` | durable store connection |
| `HANDLE_ENC_KEY` | field-encryption key for `handle_enc` |
| `PORT`, `NODE_ENV` | runtime |

## Deploy options

| Option | Code change | Store | Notes |
|---|---|---|---|
| **Container** (Fly.io / Render / Railway) | **least** — runs `src/serve.ts` as-is (long-running `node:http`) | managed Postgres | fastest to live; one Dockerfile |
| **Vercel** (functions) | moderate — wrap routes as `/api/*` handlers | Vercel Postgres / KV | matches Kevin's existing stack |
| **Cloudflare Workers** | most — rewrite to `fetch` handlers | KV + **Durable Objects** (DO gives the CAS natively) | matches the plan's ASSUMPTION-A1 |

The **spine is runtime-agnostic pure TS**, so it survives any choice; only `http/server.ts` and the
store adapter are host-specific.

## Hardening checklist (in our control)

- [ ] Rate-limit `/share` per IP/account; body-size caps (already enforced in `mint`)
- [ ] Structured logging with token/secret scrubbing (log token **prefix/hash** only)
- [ ] Field-encrypt `handle_enc`; lock `/continuity/*` re-identification reads to the agent runtime + audit-log
- [ ] Graceful shutdown; readiness vs liveness on `/healthz`
- [ ] Per-`linkSource` circuit breaker + billable-Opaque-ID metering (designed in the plan)
- [ ] CI: `npm test` + `npm run typecheck` on every push

## Go-live sequence

1. Pick a deploy target → add the durable store adapter + async the store interface → deploy (mock MSP).
2. Obtain `POKE_BUSINESS_UUID` + MSP creds → wire the real MSP adapter → set env/secrets.
3. Clear **LAUNCH GATE 0** (on-device bcrw routing) and **LAUNCH GATE 1** (correlation legality).
4. Point the MSP webhook at `/amb/ingress`; verify HMAC; canary with one test Opaque ID.
5. Flip on.
