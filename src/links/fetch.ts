// Page fetcher for the `fetch_link` MCP tool — returns readable text so Poke can summarize
// or answer about a page. Reader-mode extraction (main content, not site chrome) keeps the
// summary input clean; structure-preserving newlines + entity decoding keep it legible.

// --- SSRF guard -----------------------------------------------------------------
// Hostname-pattern based. Edge runtime has no node:dns, so a hostname that RESOLVES to a
// private IP can't be fully closed here (§7) — this covers literal IPv4/IPv6 private,
// loopback, link-local ranges + cloud-metadata names, the realistic exposure for a
// user-pasted URL.
const BLOCKED_HOST: RegExp[] = [
  /^localhost$/i,
  /^127\./, // IPv4 loopback
  /^0\./, // "this" network
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local + cloud metadata (169.254.169.254)
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16/12
  /^::1$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified
  /^fe80:/i, // IPv6 link-local
  /^f[cd][0-9a-f]{0,2}:/i, // IPv6 unique-local fc00::/7
  /\.internal$/i,
  /\.local$/i,
  /metadata/i, // metadata.google.internal & friends
];

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase(); // unwrap [IPv6]
  return BLOCKED_HOST.some((re) => re.test(h));
}

// --- HTML entity decoding --------------------------------------------------------
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™", deg: "°",
};

function fromCodePoint(cp: number): string {
  try {
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  } catch {
    return "";
  }
}

/** Decode HTML entities: hex/decimal numeric refs + a set of common named ones. Exported for testing. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => NAMED[name] ?? m);
}

// --- Reader-mode extraction ------------------------------------------------------
const DROP_BLOCKS = /<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi;
const BOILERPLATE = /<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi;
const BLOCK_CLOSE = /<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|ul|ol|pre|table)>/gi;

function extractMain(html: string): string {
  const cleaned = html.replace(DROP_BLOCKS, " ");
  // Prefer an explicit main-content region when the page marks one up.
  const region = cleaned.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i);
  const inner = region?.[2];
  if (inner && inner.trim()) return inner;
  // Otherwise use <body> (or the whole doc) with common chrome removed.
  const body = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  return (body ?? cleaned).replace(BOILERPLATE, " ");
}

/** HTML → readable, paragraph-structured text (main content only). Exported for testing. */
export function htmlToText(html: string): string {
  const withBreaks = extractMain(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_CLOSE, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks)
    .replace(/[ \t\f\v ]+/g, " ") // collapse inline whitespace, keep newlines
    .replace(/ *\n */g, "\n") // trim around line breaks
    .replace(/\n{3,}/g, "\n\n") // cap blank-line runs
    .trim();
}

/** The page's title (`<title>`, else first `<h1>`), decoded — useful context for a summary. */
export function pageTitle(html: string): string | undefined {
  const raw =
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (!raw) return undefined;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || undefined;
}

// --- Public entry ----------------------------------------------------------------
/** Fetch a page's readable text (title + main content, ≤8k chars) for Poke to summarize. */
export async function fetchReadable(url: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (!["http:", "https:"].includes(u.protocol)) return "Only http/https links are supported.";
  if (isBlockedHost(u.hostname)) return "Refusing to fetch a private/internal address.";

  let resp: Response;
  try {
    resp = await fetch(u.toString(), {
      redirect: "follow",
      headers: {
        "user-agent": "PokeLinkCompanion/0.1 (+https://poke.com)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    return `Couldn't fetch the page: ${(e as Error).message}`;
  }
  if (!resp.ok) return `Couldn't fetch the page (HTTP ${resp.status}).`;

  // Don't dump binary (images, PDFs, octet-stream) into the chat as garbled text.
  const ctype = resp.headers.get("content-type") ?? "";
  if (ctype && !/^(text\/|application\/(xhtml|xml))/i.test(ctype)) {
    return `That link isn't a readable web page (${(ctype.split(";")[0] ?? ctype).trim()}).`;
  }

  const html = await resp.text();
  const title = pageTitle(html);
  const body = htmlToText(html);
  const out = (title && !body.startsWith(title) ? `${title}\n\n${body}` : body).slice(0, 8000);
  return out.trim() || "No readable text found on the page.";
}
