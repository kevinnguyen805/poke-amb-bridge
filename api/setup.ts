import { verifyIngestToken } from "../src/links/ingestToken";
import { SHORTCUT_VERSION, SHORTCUT_RELEASED } from "../src/links/shortcutMeta";

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
  h2{font-size:1.05rem;margin:1.6rem 0 0.6rem;border-top:1px solid #e8e4da;padding-top:1.2rem}
  ol,ul{padding-left:1.2rem;line-height:1.6}
  ol>li{margin-bottom:1.1rem}
  ul>li{margin-bottom:0.3rem}
  p{line-height:1.55}
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
    <p class="muted">Current version: v${SHORTCUT_VERSION} (${SHORTCUT_RELEASED}). Installed copies never update themselves — if you added the Shortcut before that date, delete the old copy first.</p>
  </li>
  <li>Test it now: open any article, tap Share → <b>Save to Poke</b>. You'll see a <b>“Saved ✓”</b> banner and nothing else opens — the link lands silently in your private list. No chat starts, Poke won't message you about it.</li>
</ol>
<h2>Getting value out of it</h2>
<p><b>Save anything you'd otherwise lose in open tabs:</b> articles to read later, products you're comparing, recipes, job posts, places to try, gift ideas, videos.</p>
<p><b>Then just ask Poke, anytime:</b></p>
<ul>
  <li>“what did I save this week?”</li>
  <li>“find my links about pricing”</li>
  <li>“summarize that article I saved yesterday”</li>
</ul>
<p><b>Make it yours:</b> when saving in chat you can add context — <i>“save this with a note ‘for the offsite’ and tag travel”</i> — then pull links back by tag or topic later, or ask for a digest of everything you saved this week.</p>
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
