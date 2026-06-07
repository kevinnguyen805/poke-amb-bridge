import { buildBcrwOpenChatUrl } from "./bcrw";

export type VCardOpts = {
  businessUuid: string;
  imessageNumber?: string;
  orgName?: string;
  fullName?: string;
};

/**
 * Hybrid contact card (vCard 3.0 / RFC 2426). The TEL drives Siri/Share-Sheet/Shortcut targeting;
 * the item-grouped URL renders a tappable "Apple Messages" link into the AMB thread.
 * (`URL;type=Apple Messages` does NOT work — iOS ignores arbitrary URL TYPE values.)
 */
export function buildVCard(opts: VCardOpts): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${opts.fullName ?? "Poke"}`, `ORG:${opts.orgName ?? "The Interaction Company of California"}`];
  if (opts.imessageNumber) lines.push(`TEL;type=CELL;type=VOICE:${opts.imessageNumber}`);
  lines.push(`item1.URL:${buildBcrwOpenChatUrl(opts.businessUuid)}`);
  lines.push("item1.X-ABLabel:Apple Messages");
  lines.push(
    "NOTE:Tap \"Apple Messages\" to start a rich chat with Poke's AI agent. You'll always tap Send yourself — Poke never sends for you.",
  );
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}
