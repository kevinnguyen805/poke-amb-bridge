import type { ShareTokenRecord, ContinuityLink } from "./types";

export type ConsumeStatus = "won" | "replay" | "foreign" | "missing";
export type ConsumeResult = { status: ConsumeStatus; record?: ShareTokenRecord };

/**
 * SHARE_TOKENS — short-TTL KV. The `consume` method models the durable store's
 * compare-and-set: stamp consumedAt/consumedBy only if currently unconsumed, so a token
 * is single-use and a post-consumption presentation by another opaqueId is rejected.
 * (Real impl: `UPDATE ... SET consumedAt=? WHERE token=? AND consumedAt IS NULL`.)
 */
export class InMemoryTokenStore {
  private m = new Map<string, ShareTokenRecord>();

  put(rec: ShareTokenRecord): void {
    this.m.set(rec.token, { ...rec });
  }

  get(token: string): ShareTokenRecord | undefined {
    const r = this.m.get(token);
    return r ? { ...r } : undefined;
  }

  consume(token: string, opaqueId: string, now: string): ConsumeResult {
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

/** CONTINUITY — durable link registry, keyed (idempotent) on opaqueId. */
export class InMemoryContinuityStore {
  private m = new Map<string, ContinuityLink>();

  get(opaqueId: string): ContinuityLink | undefined {
    const l = this.m.get(opaqueId);
    return l ? { ...l } : undefined;
  }

  put(link: ContinuityLink): void {
    this.m.set(link.opaqueId, { ...link });
  }
}
