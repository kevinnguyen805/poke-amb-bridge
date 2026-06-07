import { describe, it, expect } from "vitest";
import { buildVCard } from "../src/spine/vcard";

const UUID = "00000000-1111-2222-3333-444444444444";

describe("buildVCard", () => {
  it("emits a vCard 3.0 with the iMessage number and a labeled bcrw open_chat link", () => {
    const v = buildVCard({ businessUuid: UUID, imessageNumber: "+1-555-0100" });
    expect(v).toContain("BEGIN:VCARD");
    expect(v).toContain("VERSION:3.0");
    expect(v).toContain("FN:Poke");
    expect(v).toContain("TEL;type=CELL;type=VOICE:+1-555-0100");
    // Apple item-grouping is the only way a custom URL label renders ("URL;type=..." is ignored).
    expect(v).toContain(`item1.URL:https://bcrw.apple.com/urn:biz:${UUID}?biz-intent-id=open_chat`);
    expect(v).toContain("item1.X-ABLabel:Apple Messages");
    expect(v.trim().endsWith("END:VCARD")).toBe(true);
  });

  it("omits the TEL line when no number is provided", () => {
    const v = buildVCard({ businessUuid: UUID });
    expect(v).not.toContain("TEL");
    expect(v).toContain("item1.X-ABLabel:Apple Messages");
  });
});
