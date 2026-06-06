import { isValidToken } from "./token";
import type { Intent } from "./types";

const BASE = "https://bcrw.apple.com/urn:biz:";

/**
 * Canonical tokenized bcrw Universal Link.
 * VL-1: reserved chars are PERCENT-ENCODED, never stripped. The only reserved char a base62
 * `poke:<token>` body contains is `:`, which encodeURIComponent turns into `%3A`.
 */
export function buildBcrwUrl(businessUuid: string, intent: Intent, token: string): string {
  if (!isValidToken(token)) throw new Error(`refusing to build bcrw URL with invalid token: ${token}`);
  const body = encodeURIComponent("poke:" + token);
  return `${BASE}${businessUuid}?biz-intent-id=${intent}&body=${body}`;
}

/** Tokenless cold entry (vCard / QR / NFC / Wallet) — `body` omitted by design. */
export function buildBcrwOpenChatUrl(businessUuid: string): string {
  return `${BASE}${businessUuid}?biz-intent-id=open_chat`;
}

/** Documented plan-B if `Open URLs` → bcrw fails to reach AMB on-device (LAUNCH GATE 0). */
export function buildSmsOpenFallback(businessUuid: string): string {
  return `https://bcrw.apple.com/sms:open?service=iMessage&recipient=urn:biz:${businessUuid}`;
}
