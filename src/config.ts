import { neon } from "@neondatabase/serverless";
import { InMemoryTokenStore, InMemoryContinuityStore } from "./spine/store";
import { LoggingMsp } from "./spine/msp";
import { systemClock } from "./spine/types";
import { PgTokenStore, PgContinuityStore, migrate, type Sql } from "./store/pg";
import type { CoreDeps } from "./http/core";

// Cache the built deps (and the one-time migration) for the lifetime of a warm instance.
let cached: Promise<CoreDeps> | undefined;

export function depsFromEnv(): Promise<CoreDeps> {
  if (!cached) cached = build();
  return cached;
}

async function build(): Promise<CoreDeps> {
  const businessUuid = process.env.POKE_BUSINESS_UUID ?? "11111111-2222-3333-4444-555555555555";
  const scopedKey = process.env.POKE_SCOPED_KEY ?? "pk_shortcut_demo";
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
      msp: new LoggingMsp(),
      clock: systemClock,
      businessUuid,
      scopedKey,
      mspSecret,
    };
  }

  // No DB configured → ephemeral in-memory (fine for /healthz and smoke, NOT durable across invocations).
  return {
    tokens: new InMemoryTokenStore(),
    continuity: new InMemoryContinuityStore(),
    msp: new LoggingMsp(),
    clock: systemClock,
    businessUuid,
    scopedKey,
    mspSecret,
  };
}
