import { neon } from "@neondatabase/serverless";
import { InMemoryTokenStore, InMemoryContinuityStore } from "./spine/store";
import { InMemoryRateLimiter } from "./spine/ratelimit";
import { LoggingMsp } from "./spine/msp";
import { systemClock } from "./spine/types";
import { PgTokenStore, PgContinuityStore, PgRateLimiter, migrate, type Sql } from "./store/pg";
import type { CoreDeps } from "./http/core";
import { saveLink } from "./links/store";

// Cache the built deps (and the one-time migration) for the lifetime of a warm instance.
let cached: Promise<CoreDeps> | undefined;

export function depsFromEnv(): Promise<CoreDeps> {
  if (!cached) cached = build();
  return cached;
}

/** Public scalar config (no DB) — used by the DB-free doorway endpoints (vcard/open/wallet). */
export function publicConfig() {
  return {
    businessUuid: process.env.POKE_BUSINESS_UUID ?? "11111111-2222-3333-4444-555555555555",
    imessageNumber: process.env.POKE_IMESSAGE_NUMBER ?? "+1-555-0100",
    passTypeId: process.env.POKE_PASS_TYPE_ID ?? "pass.com.poke.bridge",
    teamId: process.env.POKE_TEAM_ID ?? "TEAMID0000",
  };
}

async function build(): Promise<CoreDeps> {
  const businessUuid = publicConfig().businessUuid;
  const scopedKey = process.env.POKE_SCOPED_KEY ?? "pk_shortcut_demo";
  // Per-user spk_ ingest tokens (Save to Poke). Falls back to the scoped key so prod works with no new env.
  const ingestTokenSecret = process.env.INGEST_TOKEN_SECRET ?? scopedKey;
  const mspSecret = process.env.MSP_SECRET ?? "msp_secret_demo";
  // Neon's Vercel integration may expose the URL under any of these names.
  const dbUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL_UNPOOLED;

  if (dbUrl) {
    // Stateless HTTP query driver — no persistent connection to go stale across invocations.
    const client = neon(dbUrl, { fullResults: true });
    const run = client as unknown as (
      q: string,
      params: unknown[],
    ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
    const sql: Sql = async (text, params = []) => {
      const r = await run(text, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    };
    await migrate(sql);
    return {
      tokens: new PgTokenStore(sql),
      continuity: new PgContinuityStore(sql),
      rateLimiter: new PgRateLimiter(sql),
      msp: new LoggingMsp(),
      clock: systemClock,
      businessUuid,
      scopedKey,
      mspSecret,
      saveLink,
      ingestTokenSecret,
    };
  }

  // No DB configured → ephemeral in-memory (fine for /healthz and smoke, NOT durable across invocations).
  return {
    tokens: new InMemoryTokenStore(),
    continuity: new InMemoryContinuityStore(),
    rateLimiter: new InMemoryRateLimiter(),
    msp: new LoggingMsp(),
    clock: systemClock,
    businessUuid,
    scopedKey,
    mspSecret,
    saveLink,
    ingestTokenSecret,
  };
}
