import { generateToken } from "./token";
import { buildBcrwUrl } from "./bcrw";
import type { InMemoryTokenStore } from "./store";
import type { Clock, Intent, LinkSource, SharedPayload, ShareTokenRecord, TokenClass } from "./types";

/** The credential class determines the token class. `handle` is NEVER part of the request. */
export type Principal = { kind: "scoped-key" } | { kind: "session"; pokeAccountId: string };

export type MintRequest = {
  intent?: Intent;
  payload: SharedPayload;
  bind?: boolean; // request account binding (requires a session + valid consent)
  consentRef?: string;
  linkSource?: LinkSource;
};

export type MintResult = {
  token: string;
  tokenClass: TokenClass;
  ttl: number;
  expiresAt: string;
  bcrwUrl: string;
};

export type MintDeps = {
  tokens: InMemoryTokenStore;
  businessUuid: string;
  clock: Clock;
  newToken?: () => string;
  isConsentValid?: (ref: string) => boolean;
};

export class MintError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "MintError";
  }
}

const TTL_ANON = 900;
const TTL_BOUND = 120;
const CAPS = { url: 2048, text: 4096, note: 512 } as const;

function validatePayload(p: SharedPayload): void {
  if (p.url !== undefined) {
    const scheme = (p.url.split(":")[0] ?? "").toLowerCase();
    if (!["http", "https", "mailto"].includes(scheme)) {
      throw new MintError(400, `payload url scheme not allowed: ${scheme}`);
    }
    if (Buffer.byteLength(p.url, "utf8") > CAPS.url) throw new MintError(400, "payload url too large");
  }
  if (p.text !== undefined && Buffer.byteLength(p.text, "utf8") > CAPS.text) {
    throw new MintError(400, "payload text too large");
  }
  if (p.note !== undefined && Buffer.byteLength(p.note, "utf8") > CAPS.note) {
    throw new MintError(400, "payload note too large");
  }
}

export function mint(deps: MintDeps, principal: Principal, req: MintRequest): MintResult {
  const newToken = deps.newToken ?? generateToken;
  const isConsentValid = deps.isConsentValid ?? ((r: string) => !!r);
  const intent: Intent = req.intent ?? "share";

  validatePayload(req.payload);

  // Account binding is gated. handle is server-derived from the session, never caller-asserted.
  let tokenClass: TokenClass = "anonymous";
  let pokeAccountIdRef: string | undefined;
  let consentRef: string | undefined;

  if (req.bind === true) {
    if (principal.kind !== "session") {
      throw new MintError(403, "a non-session principal can never bind a Poke account");
    }
    if (!req.consentRef || !isConsentValid(req.consentRef)) {
      throw new MintError(403, "account-bound mint requires a valid consentRef");
    }
    tokenClass = "account-bound";
    pokeAccountIdRef = principal.pokeAccountId;
    consentRef = req.consentRef;
  }

  const ttl = tokenClass === "account-bound" ? TTL_BOUND : TTL_ANON;
  const now = deps.clock.now();
  const linkSource: LinkSource = req.linkSource ?? (principal.kind === "scoped-key" ? "shortcut" : "banner");
  const token = newToken();

  const record: ShareTokenRecord = {
    token,
    tokenClass,
    intent,
    linkSource,
    pokeAccountIdRef,
    consentRef,
    payload: req.payload,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    ttl,
  };
  deps.tokens.put(record);

  return {
    token,
    tokenClass,
    ttl,
    expiresAt: record.expiresAt,
    bcrwUrl: buildBcrwUrl(deps.businessUuid, intent, token),
  };
}
