import { buildBcrwOpenChatUrl } from "./bcrw";

export type PassOpts = {
  businessUuid: string;
  passTypeId: string;
  teamId: string;
  imessageNumber?: string;
  orgName?: string;
  serialNumber?: string;
};

type BackField = { key: string; label: string; value: string; attributedValue?: string };

/**
 * Apple Wallet `pass.json` structure. A *signed, installable* `.pkpass` additionally requires the
 * manifest + a detached PKCS#7 signature from a Pass Type ID certificate (see PRODUCTION.md /
 * the plan's T2-D7a signing checklist) — this builds the content, ready to sign.
 */
export function buildPassJson(opts: PassOpts) {
  const url = buildBcrwOpenChatUrl(opts.businessUuid);
  const backFields: BackField[] = [
    {
      key: "messages",
      label: "Message Poke",
      value: "Open in Apple Messages",
      attributedValue: `<a href="${url}">Open chat in Apple Messages</a>`,
    },
  ];
  if (opts.imessageNumber) {
    backFields.push({
      key: "imessage",
      label: "Or text us",
      value: opts.imessageNumber,
      attributedValue: `<a href="sms:${opts.imessageNumber}">${opts.imessageNumber}</a>`,
    });
  }
  backFields.push({
    key: "note",
    label: "Note",
    value:
      "Poke is an AI agent. A human is always available — just ask. Only you can start the conversation; tap the link above, then hit Send.",
  });

  return {
    formatVersion: 1,
    passTypeIdentifier: opts.passTypeId,
    teamIdentifier: opts.teamId,
    organizationName: opts.orgName ?? "The Interaction Company of California",
    serialNumber: opts.serialNumber ?? "poke-bridge-0001",
    description: "Message Poke in Apple Messages",
    logoText: "Poke",
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(20, 20, 22)",
    labelColor: "rgb(170, 170, 175)",
    storeCard: {
      headerFields: [{ key: "status", label: "AI AGENT", value: "Poke" }],
      primaryFields: [{ key: "channel", label: "Channel", value: "Apple Messages for Business" }],
      secondaryFields: [{ key: "tap", label: "To start", value: "Tap the link on the back, then Send" }],
      backFields,
    },
    barcodes: [
      { format: "PKBarcodeFormatQR", message: url, messageEncoding: "iso-8859-1", altText: "Scan to message Poke" },
    ],
  };
}
