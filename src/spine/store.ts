import type { ShareTokenRecord, ContinuityLink } from "./types";

export type ConsumeStatus = "won" | "replay" | "foreign" | "missing";
export type ConsumeResult = { status: ConsumeStatus; record?: ShareTokenRecord };

/**
 * SHARE_TOKENS — short-TTL store. Async so a real backend (Postgres/KV) drops in unchanged.
 * `consume` is the compare-and-set single-use primitive (DB: `UPDATE ... WHERE consumed_at IS NULL`).
 */
export interface TokenStore {
  put(rec: ShareTokenRecord): Promise<void>;
  get(token: string): Promise<ShareTokenRecord | undefined>;
  consume(token: string, opaqueId: string, now: string): Promise<ConsumeResult>;
}

/** CONTINUITY — durable link registry, keyed (idempotent) on opaqueId. */
export interface ContinuityStore {
  get(opaqueId: string): Promise<ContinuityLink | undefined>;
  put(link: ContinuityLink): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private m = new Map<string, ShareTokenRecord>();

  async put(rec: ShareTokenRecord): Promise<void> {
    this.m.set(rec.token, { ...rec });
  }

  async get(token: string): Promise<ShareTokenRecord | undefined> {
    const r = this.m.get(token);
    return r ? { ...r } : undefined;
  }

  async consume(token: string, opaqueId: string, now: string): Promise<ConsumeResult> {
    const rec = this.m.get(token);
    if (!rec) return { status: "missing" };
    if (rec.consumedAt) {
      return rec.consumedBy === opaqueId
        ? { status: "replay", record: { ...rec } }
        : { status: "foreign", record: { ...rec } };
    }
    rec.consumedAt = now;
    rec.consumedBy = opaqueId;
    return { status: "won", record: { ...rec } };
  }
}

export class InMemoryContinuityStore implements ContinuityStore {
  private m = new Map<string, ContinuityLink>();

  async get(opaqueId: string): Promise<ContinuityLink | undefined> {
    const l = this.m.get(opaqueId);
    return l ? { ...l } : undefined;
  }

  async put(link: ContinuityLink): Promise<void> {
    this.m.set(link.opaqueId, { ...link });
  }
}
