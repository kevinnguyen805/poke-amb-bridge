import { describe, it, expect } from "vitest";
import handler from "../api/setup";
import { mintIngestToken } from "../src/links/ingestToken";

// POKE_SCOPED_KEY / INGEST_TOKEN_SECRET are unset in tests → the page verifies
// against the same "pk_shortcut_demo" default the MCP setup tool mints with.
const SECRET = "pk_shortcut_demo";

function get(query: string): Request {
  return new Request(`https://x/setup${query}`);
}

describe("GET /setup — human-facing key handoff page", () => {
  it("renders the key, a copy button, and the Shortcut link for a valid token", async () => {
    const token = await mintIngestToken(SECRET, "4c542392-0000-0000-0000-000000000000");
    const res = await handler(get(`?k=${token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html, "page must show the exact key for copying").toContain(token);
    expect(html).toContain("/save-to-poke.shortcut");
    expect(html.toLowerCase()).toContain("copy");
    // The user id is a read-credential on this server — it must never be rendered.
    expect(html).not.toContain("4c542392-0000-0000-0000-000000000000");
  });

  it("teaches first-run usage: test-it step, silent-save expectation, what to save, example asks", async () => {
    const token = await mintIngestToken(SECRET, "4c542392-0000-0000-0000-000000000000");
    const html = await (await handler(get(`?k=${token}`))).text();
    // Step 3 is a do-it-now test with the expected outcome spelled out — and the
    // expectation must match the shortcut: success = vibration only, NO banner.
    expect(html).toContain("Test it now");
    expect(html).toContain("vibration");
    expect(html).not.toContain("Saved ✓");
    expect(html.toLowerCase()).toContain("no banner, no chat starts");
    // Value section: what's worth saving + concrete retrieval phrasings + tailoring.
    expect(html).toContain("Getting value out of it");
    expect(html.toLowerCase()).toContain("articles to read later");
    expect(html).toContain("what did I save this week?");
    expect(html.toLowerCase()).toContain("tag travel");
  });

  it("rejects a tampered token with an error page that does NOT echo it as valid", async () => {
    const token = await mintIngestToken(SECRET, "4c542392-0000-0000-0000-000000000000");
    const forged = token.slice(0, -2) + "ff";
    const res = await handler(get(`?k=${forged}`));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).not.toContain(forged);
    expect(html.toLowerCase()).toContain("set up save to poke");
  });

  it("handles a missing ?k= with instructions to ask Poke", async () => {
    const res = await handler(get(""));
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain("ask poke");
  });
});
