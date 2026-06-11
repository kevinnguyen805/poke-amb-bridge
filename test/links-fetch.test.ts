import { describe, it, expect } from "vitest";
import { fetchReadable, htmlToText, decodeEntities, isBlockedHost, pageTitle } from "../src/links/fetch";

describe("isBlockedHost (SSRF guard)", () => {
  it("blocks IPv4 loopback / private / link-local / metadata names", () => {
    for (const h of [
      "localhost", "127.0.0.1", "0.0.0.0", "10.1.2.3", "192.168.0.1",
      "169.254.169.254", "172.16.0.1", "172.31.255.1", "foo.internal", "bar.local",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks IPv6 loopback / unique-local / link-local (incl. bracketed)", () => {
    for (const h of ["::1", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows ordinary public hosts (incl. 172.x outside the private block)", () => {
    for (const h of ["example.com", "www.github.com", "8.8.8.8", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});

describe("decodeEntities", () => {
  it("decodes named entities", () => {
    expect(decodeEntities("a&amp;b &lt;x&gt; &quot;q&quot; &nbsp;z")).toBe('a&b <x> "q"  z');
  });
  it("decodes decimal and hex numeric entities, and a typographic named one", () => {
    expect(decodeEntities("It&#8217;s &#x2014; done &mdash; ok &#39;y&#39;")).toBe("It’s — done — ok 'y'");
  });
  it("leaves unknown entities untouched", () => {
    expect(decodeEntities("keep &notareal; here")).toBe("keep &notareal; here");
  });
});

describe("htmlToText (reader-mode extraction)", () => {
  it("prefers the <article> body and drops nav/header/footer chrome", () => {
    const html = `<html><body>
      <nav>HOME ABOUT CONTACT</nav>
      <header>SITE BANNER</header>
      <article><h1>Real Title</h1><p>First paragraph.</p><p>Second paragraph.</p></article>
      <footer>COPYRIGHT FOOTER</footer>
    </body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Real Title");
    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second paragraph.");
    expect(text).not.toContain("HOME ABOUT");
    expect(text).not.toContain("SITE BANNER");
    expect(text).not.toContain("COPYRIGHT FOOTER");
  });

  it("preserves paragraph breaks instead of running text together", () => {
    expect(htmlToText("<article><p>One</p><p>Two</p></article>")).toBe("One\nTwo");
  });

  it("strips <script> and <style> content entirely", () => {
    expect(htmlToText("<article><script>evil()</script><style>.x{color:red}</style><p>Body</p></article>")).toBe("Body");
  });

  it("falls back to stripping boilerplate when there is no <article>/<main>", () => {
    const text = htmlToText("<body><nav>MENU MENU</nav><div><p>Just content.</p></div></body>");
    expect(text).toContain("Just content.");
    expect(text).not.toContain("MENU");
  });
});

describe("pageTitle", () => {
  it("extracts <title>, decoding entities", () => {
    expect(pageTitle("<head><title>My &amp; Page</title></head>")).toBe("My & Page");
  });
  it("falls back to the first <h1>", () => {
    expect(pageTitle("<body><h1>Heading One</h1><h1>Second</h1></body>")).toBe("Heading One");
  });
  it("returns undefined when there is neither", () => {
    expect(pageTitle("<p>no title here</p>")).toBeUndefined();
  });
});

describe("fetchReadable guards (no network needed)", () => {
  it("rejects an invalid URL", async () => {
    expect(await fetchReadable("not a url")).toMatch(/valid URL/i);
  });
  it("rejects non-http(s) schemes", async () => {
    expect(await fetchReadable("ftp://example.com/file")).toMatch(/http/i);
  });
  it("refuses private/internal hosts before fetching", async () => {
    expect(await fetchReadable("http://localhost:8080/admin")).toMatch(/private|internal/i);
    expect(await fetchReadable("http://169.254.169.254/latest/meta-data")).toMatch(/private|internal/i);
  });
});
