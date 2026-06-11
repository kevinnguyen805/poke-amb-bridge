import { verifyIngestToken } from "../src/links/ingestToken";

export const config = { runtime: "edge" };

// GET /setup?k=spk_… — the human-facing half of setup_save_to_poke. Chat surfaces are
// hostile to raw secrets (LLMs paraphrase or withhold them; poke.com's chat has no
// text selection), so the MCP tool hands out THIS link instead and the page does the
// copying. The token is verified (HMAC) before being rendered; a tampered link gets an
// error page, never a plausible-looking key. Write-only token ⇒ a leaked URL can add
// links to one list but never read anything.
const SHORTCUT_PATH = "/save-to-poke.shortcut";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#fffdfa;color:#1c1c1c;margin:0;padding:24px;display:flex;justify-content:center}
  main{max-width:26rem;width:100%}
  h1{font-size:1.4rem;margin:0.5rem 0 1rem}
  ol{padding-left:1.2rem;line-height:1.6}
  li{margin-bottom:1.1rem}
  code{display:block;background:#f4f1ea;border:1px solid #ddd;border-radius:8px;padding:10px;word-break:break-all;font-size:0.85rem;margin:8px 0}
  button,a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;background:#1c1c1c;color:#fffdfa;border:none;border-radius:10px;padding:14px;font-size:1rem;font-weight:600;text-decoration:none;cursor:pointer;margin:8px 0}
  .muted{color:#777;font-size:0.85rem}
</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const ASK_AGAIN = `<h1>Save to Poke</h1>
<p>This setup link is missing or invalid. Ask Poke: <b>“set up Save to Poke”</b> — it will send you a fresh link.</p>`;

export default async function handler(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("k") ?? "";
  const secret = process.env.INGEST_TOKEN_SECRET ?? process.env.POKE_SCOPED_KEY ?? "pk_shortcut_demo";
  const userId = await verifyIngestToken(secret, token);
  if (!userId) return page("Save to Poke — invalid link", ASK_AGAIN, 400);

  const body = `<h1>Set up “Save to Poke”</h1>
<ol>
  <li>Copy your personal save key:
    <code id="key">${token}</code>
    <button id="copy">Copy key</button>
  </li>
  <li>Add the Shortcut — when it asks for your <b>Save to Poke key</b>, paste:
    <a class="btn" href="${SHORTCUT_PATH}">Get the Shortcut</a>
    <p class="muted">If it downloads as a file, open it from Downloads — it opens in the Shortcuts app.</p>
  </li>
  <li>Done. Share any page → <b>Save to Poke</b>. Ask Poke to list your saved links anytime.</li>
</ol>
<script>
  document.getElementById("copy").addEventListener("click", async () => {
    const t = document.getElementById("key").textContent;
    try { await navigator.clipboard.writeText(t); }
    catch {
      const r = document.createRange(); r.selectNodeContents(document.getElementById("key"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy");
    }
    document.getElementById("copy").textContent = "Copied ✓";
  });
</script>`;
  return page("Set up Save to Poke", body);
}
