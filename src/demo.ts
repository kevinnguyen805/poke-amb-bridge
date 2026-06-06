/**
 * Runnable narrative of the Tier-1 spine. `npm run demo`.
 * Shows the three plan User Flows end to end against in-memory stores + a mock MSP.
 */
import {
  mint,
  resolve,
  InMemoryTokenStore,
  InMemoryContinuityStore,
  MockMsp,
  buildBcrwOpenChatUrl,
  type Clock,
  type ResolveDeps,
} from "./spine/index";

const UUID = "11111111-2222-3333-4444-555555555555";
const clock: Clock = { now: () => new Date("2026-06-05T18:00:00.000Z") };
const bodyFromBcrw = (url: string) => decodeURIComponent(url.split("body=")[1]!);

function line(s = "") {
  console.log(s);
}

function world() {
  const tokens = new InMemoryTokenStore();
  const continuity = new InMemoryContinuityStore();
  const msp = new MockMsp();
  const deps: ResolveDeps = { tokens, continuity, msp, clock };
  return { tokens, continuity, msp, deps };
}

line("== Poke One-Channel Bridge — Tier-1 spine demo ==");
line("(in-memory stores; MSP/Apple boundary mocked)\n");

// ---- Flow 1: Share-to-Poke (anonymous) ----
line("FLOW 1  Share-to-Poke (Shortcut → AMB, anonymous)");
{
  const w = world();
  const minted = mint(
    { tokens: w.tokens, businessUuid: UUID, clock },
    { kind: "scoped-key" },
    { payload: { kind: "url", url: "https://example.com/article" } },
  );
  line(`  mint  → tokenClass=${minted.tokenClass} ttl=${minted.ttl}s`);
  line(`  bcrw  → ${minted.bcrwUrl}`);
  const out = resolve(w.deps, {
    opaqueId: "urrn_user_1",
    body: bodyFromBcrw(minted.bcrwUrl),
    receivedAt: clock.now().toISOString(),
  });
  const reply = w.msp.sent[0]!.msg;
  line(`  send  → branch=${out.branch} accountBound=${out.accountBound} linkSource=${out.link.linkSource}`);
  line(`  reply → "${reply.text}"  [aiLabeled=${reply.aiLabeled}, escalation=${reply.escalation}]`);
  line(`  pii   → token store holds raw handle? ${"handle" in w.tokens.get(minted.token)!}\n`);
}

// ---- Flow (consented binding) ----
line("FLOW 2  Consented binding (session + logged consent → account-bound)");
{
  const w = world();
  const minted = mint(
    { tokens: w.tokens, businessUuid: UUID, clock },
    { kind: "session", pokeAccountId: "acct_99" },
    { bind: true, consentRef: "consent_logged", payload: { kind: "text", text: "link me" }, linkSource: "imessage_cta" },
  );
  line(`  mint  → tokenClass=${minted.tokenClass} ttl=${minted.ttl}s linkSource=imessage_cta`);
  const out = resolve(w.deps, {
    opaqueId: "urrn_user_2",
    body: bodyFromBcrw(minted.bcrwUrl),
    receivedAt: clock.now().toISOString(),
  });
  line(`  bind  → accountBound=${out.accountBound} pokeAccountId=${w.continuity.get("urrn_user_2")?.pokeAccountId}\n`);
}

// ---- Single-use / takeover rejection ----
line("FLOW 3  Single-use: a second opaque ID replaying the same link is rejected");
{
  const w = world();
  const minted = mint(
    { tokens: w.tokens, businessUuid: UUID, clock },
    { kind: "scoped-key" },
    { payload: { kind: "url", url: "https://example.com/a" } },
  );
  const body = bodyFromBcrw(minted.bcrwUrl);
  const a = resolve(w.deps, { opaqueId: "urrn_owner", body, receivedAt: clock.now().toISOString() });
  const b = resolve(w.deps, { opaqueId: "urrn_attacker", body, receivedAt: clock.now().toISOString() });
  line(`  owner    → branch=${a.branch}`);
  line(`  attacker → branch=${b.branch} (no bind, no merge)\n`);
}

// ---- Cold start via tokenless open_chat (QR/web) ----
line("FLOW 4  Cold start (tokenless open_chat, e.g. QR / poke.com)");
{
  const w = world();
  line(`  qr    → ${buildBcrwOpenChatUrl(UUID)}`);
  const out = resolve(w.deps, { opaqueId: "urrn_user_3", body: "hi what can you do", bizGroupId: "qr", receivedAt: clock.now().toISOString() });
  line(`  send  → branch=${out.branch} linkSource=${out.link.linkSource}\n`);
}

line("done.");
