import { describe, it, expect } from "vitest";
import { mintIngestToken, verifyIngestToken, looksLikeIngestToken } from "../src/links/ingestToken";

const SECRET = "test_secret";
const UID = "0442c7c3-25c9-4f69-9c05-af23af0bf6dc";

describe("ingest token mint/verify", () => {
  it("round-trips: a minted token verifies back to the same user id", async () => {
    const token = await mintIngestToken(SECRET, UID);
    expect(looksLikeIngestToken(token)).toBe(true);
    await expect(verifyIngestToken(SECRET, token)).resolves.toBe(UID);
  });

  it("is idempotent: the same user always gets the same token (re-setup is safe)", async () => {
    const a = await mintIngestToken(SECRET, UID);
    const b = await mintIngestToken(SECRET, UID);
    expect(a).toBe(b);
  });

  it("different users get different tokens", async () => {
    const a = await mintIngestToken(SECRET, UID);
    const b = await mintIngestToken(SECRET, "4c542392-0000-0000-0000-000000000000");
    expect(a).not.toBe(b);
  });

  it("rejects a token minted under a different secret", async () => {
    const token = await mintIngestToken("other_secret", UID);
    await expect(verifyIngestToken(SECRET, token)).resolves.toBeUndefined();
  });

  it("rejects a tampered user id (re-bound payload keeps the old MAC)", async () => {
    const token = await mintIngestToken(SECRET, UID);
    const mac = token.slice(token.lastIndexOf(".") + 1);
    const forged = `spk_${btoa("victim-user-id").replace(/=+$/, "")}.${mac}`;
    await expect(verifyIngestToken(SECRET, forged)).resolves.toBeUndefined();
  });

  it("rejects garbage shapes without throwing", async () => {
    for (const bad of ["spk_", "spk_x", "spk_.abc", "spk_%%%.abc", "nope", ""]) {
      await expect(verifyIngestToken(SECRET, bad)).resolves.toBeUndefined();
    }
  });

  it("refuses to mint for anonymous or empty user ids", async () => {
    await expect(mintIngestToken(SECRET, "anonymous")).rejects.toThrow();
    await expect(mintIngestToken(SECRET, "")).rejects.toThrow();
  });

  it("survives non-latin1 user ids (base64url over utf-8 bytes)", async () => {
    const uid = "usér-ид-92";
    const token = await mintIngestToken(SECRET, uid);
    await expect(verifyIngestToken(SECRET, token)).resolves.toBe(uid);
  });
});
