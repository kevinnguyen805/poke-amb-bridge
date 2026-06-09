// Best-effort SSRF guard (hostname patterns). Note: doesn't resolve DNS, so a hostname pointing
// at a private IP could still slip — acceptable for v1; tighten with DNS resolution before heavy use.
const BLOCKED = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.internal$/i,
  /\.local$/i,
  /metadata/i,
];

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch a page's readable text (≤8k chars) so Poke can summarize or answer about it. */
export async function fetchReadable(url: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (!["http:", "https:"].includes(u.protocol)) return "Only http/https links are supported.";
  if (BLOCKED.some((re) => re.test(u.hostname))) return "Refusing to fetch a private/internal address.";

  let resp: Response;
  try {
    resp = await fetch(u.toString(), {
      redirect: "follow",
      headers: { "user-agent": "PokeLinkCompanion/0.1 (+https://poke.com)" },
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    return `Couldn't fetch the page: ${(e as Error).message}`;
  }
  if (!resp.ok) return `Couldn't fetch the page (HTTP ${resp.status}).`;
  const html = await resp.text();
  const text = htmlToText(html).slice(0, 8000);
  return text || "No readable text found on the page.";
}
