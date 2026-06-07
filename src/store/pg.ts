import type { TokenStore, ContinuityStore, ConsumeResult } from "../spine/store";
import type { RateLimiter } from "../spine/ratelimit";
import type {
  AgentState,
  ContinuityLink,
  Intent,
  LinkSource,
  SharedPayload,
  ShareTokenRecord,
  TokenClass,
} from "../spine/types";

/** Minimal driver port so the adapter works with @neondatabase/serverless, node-postgres, or pg-mem. */
export type Sql = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;

/** Timestamps are stored as ISO text (not timestamptz) so records round-trip byte-identical. */
export const MIGRATION = `
CREATE TABLE IF NOT EXISTS share_tokens (
  token text PRIMARY KEY,
  token_class text NOT NULL,
  intent text NOT NULL,
  link_source text NOT NULL,
  poke_account_id_ref text,
  consent_ref text,
  payload text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL,
  ttl integer NOT NULL,
  consumed_at text,
  consumed_by text
);
CREATE TABLE IF NOT EXISTS continuity_links (
  opaque_id text PRIMARY KEY,
  handle_enc text,
  poke_account_id text,
  consent_ref text,
  consent_at text,
  agent_state text NOT NULL,
  first_linked_at text NOT NULL,
  last_seen_at text NOT NULL,
  last_inbound_at text NOT NULL,
  linked_via text NOT NULL,
  link_source text NOT NULL,
  always_reply_on_amb boolean,
  relink_of text
);
`;

export async function migrate(sql: Sql): Promise<void> {
  await sql(
    `CREATE TABLE IF NOT EXISTS share_tokens (
      token text PRIMARY KEY, token_class text NOT NULL, intent text NOT NULL, link_source text NOT NULL,
      poke_account_id_ref text, consent_ref text, payload text NOT NULL,
      created_at text NOT NULL, expires_at text NOT NULL, ttl integer NOT NULL,
      consumed_at text, consumed_by text)`,
  );
  await sql(
    `CREATE TABLE IF NOT EXISTS continuity_links (
      opaque_id text PRIMARY KEY, handle_enc text, poke_account_id text, consent_ref text, consent_at text,
      agent_state text NOT NULL, first_linked_at text NOT NULL, last_seen_at text NOT NULL,
      last_inbound_at text NOT NULL, linked_via text NOT NULL, link_source text NOT NULL,
      always_reply_on_amb boolean, relink_of text)`,
  );
  await sql(
    `CREATE TABLE IF NOT EXISTS rate_limits (
      key text PRIMARY KEY, window_start bigint NOT NULL, count integer NOT NULL)`,
  );
}

function rowToRec(r: any): ShareTokenRecord {
  return {
    token: r.token,
    tokenClass: r.token_class as TokenClass,
    intent: r.intent as Intent,
    linkSource: r.link_source as LinkSource,
    pokeAccountIdRef: r.poke_account_id_ref ?? undefined,
    consentRef: r.consent_ref ?? undefined,
    payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as SharedPayload,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    ttl: Number(r.ttl),
    consumedAt: r.consumed_at ?? undefined,
    consumedBy: r.consumed_by ?? undefined,
  };
}

function rowToLink(r: any): ContinuityLink {
  return {
    opaqueId: r.opaque_id,
    handleEnc: r.handle_enc ?? undefined,
    pokeAccountId: r.poke_account_id ?? undefined,
    consentRef: r.consent_ref ?? undefined,
    consentAt: r.consent_at ?? undefined,
    agentState: r.agent_state as AgentState,
    firstLinkedAt: r.first_linked_at,
    lastSeenAt: r.last_seen_at,
    lastInboundAt: r.last_inbound_at,
    linkedVia: r.linked_via as Intent,
    linkSource: r.link_source as LinkSource,
    alwaysReplyOnAMB: r.always_reply_on_amb ?? undefined,
    relinkOf: r.relink_of ?? undefined,
  };
}

export class PgTokenStore implements TokenStore {
  constructor(private sql: Sql) {}

  async put(rec: ShareTokenRecord): Promise<void> {
    await this.sql(
      `INSERT INTO share_tokens
        (token, token_class, intent, link_source, poke_account_id_ref, consent_ref, payload,
         created_at, expires_at, ttl, consumed_at, consumed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (token) DO UPDATE SET
         token_class=EXCLUDED.token_class, intent=EXCLUDED.intent, link_source=EXCLUDED.link_source,
         poke_account_id_ref=EXCLUDED.poke_account_id_ref, consent_ref=EXCLUDED.consent_ref,
         payload=EXCLUDED.payload, created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at,
         ttl=EXCLUDED.ttl, consumed_at=EXCLUDED.consumed_at, consumed_by=EXCLUDED.consumed_by`,
      [
        rec.token, rec.tokenClass, rec.intent, rec.linkSource, rec.pokeAccountIdRef ?? null,
        rec.consentRef ?? null, JSON.stringify(rec.payload), rec.createdAt, rec.expiresAt, rec.ttl,
        rec.consumedAt ?? null, rec.consumedBy ?? null,
      ],
    );
  }

  async get(token: string): Promise<ShareTokenRecord | undefined> {
    const r = await this.sql(`SELECT * FROM share_tokens WHERE token=$1`, [token]);
    return r.rowCount ? rowToRec(r.rows[0]) : undefined;
  }

  async consume(token: string, opaqueId: string, now: string): Promise<ConsumeResult> {
    // Compare-and-set: only the caller that flips consumed_at from NULL wins.
    const upd = await this.sql(
      `UPDATE share_tokens SET consumed_at=$2, consumed_by=$3
       WHERE token=$1 AND consumed_at IS NULL RETURNING *`,
      [token, now, opaqueId],
    );
    if (upd.rowCount === 1) return { status: "won", record: rowToRec(upd.rows[0]) };

    const cur = await this.sql(`SELECT * FROM share_tokens WHERE token=$1`, [token]);
    if (cur.rowCount === 0) return { status: "missing" };
    const rec = rowToRec(cur.rows[0]);
    return rec.consumedBy === opaqueId ? { status: "replay", record: rec } : { status: "foreign", record: rec };
  }
}

export class PgContinuityStore implements ContinuityStore {
  constructor(private sql: Sql) {}

  async get(opaqueId: string): Promise<ContinuityLink | undefined> {
    const r = await this.sql(`SELECT * FROM continuity_links WHERE opaque_id=$1`, [opaqueId]);
    return r.rowCount ? rowToLink(r.rows[0]) : undefined;
  }

  async put(link: ContinuityLink): Promise<void> {
    await this.sql(
      `INSERT INTO continuity_links
        (opaque_id, handle_enc, poke_account_id, consent_ref, consent_at, agent_state,
         first_linked_at, last_seen_at, last_inbound_at, linked_via, link_source, always_reply_on_amb, relink_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (opaque_id) DO UPDATE SET
         handle_enc=EXCLUDED.handle_enc, poke_account_id=EXCLUDED.poke_account_id, consent_ref=EXCLUDED.consent_ref,
         consent_at=EXCLUDED.consent_at, agent_state=EXCLUDED.agent_state, first_linked_at=EXCLUDED.first_linked_at,
         last_seen_at=EXCLUDED.last_seen_at, last_inbound_at=EXCLUDED.last_inbound_at, linked_via=EXCLUDED.linked_via,
         link_source=EXCLUDED.link_source, always_reply_on_amb=EXCLUDED.always_reply_on_amb, relink_of=EXCLUDED.relink_of`,
      [
        link.opaqueId, link.handleEnc ?? null, link.pokeAccountId ?? null, link.consentRef ?? null,
        link.consentAt ?? null, link.agentState, link.firstLinkedAt, link.lastSeenAt, link.lastInboundAt,
        link.linkedVia, link.linkSource, link.alwaysReplyOnAMB ?? null, link.relinkOf ?? null,
      ],
    );
  }
}

/** Fixed-window rate limiter backed by a single atomic upsert. */
export class PgRateLimiter implements RateLimiter {
  constructor(
    private sql: Sql,
    private nowMs: () => number = () => Date.now(),
  ) {}

  async hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    const bucket = Math.floor(this.nowMs() / 1000 / windowSec);
    const r = await this.sql(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = EXCLUDED.window_start
       RETURNING count`,
      [key, bucket],
    );
    const count = Number((r.rows[0] as { count: number }).count);
    return { allowed: count <= max, count };
  }
}
