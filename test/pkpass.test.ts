import { describe, it, expect } from "vitest";
import { buildPassJson } from "../src/spine/pkpass";

const UUID = "00000000-1111-2222-3333-444444444444";

describe("buildPassJson", () => {
  it("builds a Wallet pass.json with the bcrw link on the back, AI-agent labeling, and a QR", () => {
    const p = buildPassJson({ businessUuid: UUID, passTypeId: "pass.com.poke.bridge", teamId: "TEAM123", imessageNumber: "+1-555-0100" });
    expect(p.formatVersion).toBe(1);
    expect(p.passTypeIdentifier).toBe("pass.com.poke.bridge");
    expect(p.teamIdentifier).toBe("TEAM123");
    expect(JSON.stringify(p.storeCard.headerFields)).toContain("AI AGENT");
    expect(JSON.stringify(p.storeCard.backFields)).toContain(
      `https://bcrw.apple.com/urn:biz:${UUID}?biz-intent-id=open_chat`,
    );
    expect(JSON.stringify(p.storeCard.backFields)).toContain("sms:+1-555-0100");
    expect(JSON.stringify(p.barcodes)).toContain(`urn:biz:${UUID}`);
    expect(p.barcodes[0]!.messageEncoding).toBe("iso-8859-1");
  });

  it("omits the iMessage back field when no number is given", () => {
    const p = buildPassJson({ businessUuid: UUID, passTypeId: "pass.com.poke.bridge", teamId: "TEAM123" });
    expect(JSON.stringify(p.storeCard.backFields)).not.toContain("Or text us");
  });
});
