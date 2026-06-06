/**
 * Boot the bridge as a real HTTP service. `npm run serve`.
 * In-memory store + mock MSP (swap both at the deps seam for a real deployment).
 */
import { createBridgeServer } from "./http/server";
import { InMemoryTokenStore, InMemoryContinuityStore } from "./spine/store";
import { MockMsp } from "./spine/msp";
import { systemClock } from "./spine/types";

const port = Number(process.env.PORT ?? 7400);

const server = createBridgeServer({
  tokens: new InMemoryTokenStore(),
  continuity: new InMemoryContinuityStore(),
  msp: new MockMsp(),
  clock: systemClock,
  businessUuid: process.env.POKE_BUSINESS_UUID ?? "11111111-2222-3333-4444-555555555555",
  scopedKey: process.env.POKE_SCOPED_KEY ?? "pk_shortcut_demo",
  mspSecret: process.env.MSP_SECRET ?? "msp_secret_demo",
});

server.listen(port, () => {
  console.log(`poke-amb-bridge listening on http://127.0.0.1:${port}`);
  console.log(`  POST /share        (header x-poke-key)`);
  console.log(`  POST /amb/ingress  (header x-msp-signature: hmac-sha256)`);
  console.log(`  GET  /healthz`);
});
