import type { WebFacts } from "../types.ts";

/**
 * The homepage: headers, title, description, and the HTML we fingerprint.
 *
 * Capped, because a profile must not be hostage to a site that streams
 * megabytes — and the markers we look for are in the first chunk anyway.
 */

const MAX_BYTES = 400 * 1024;
const UA = "Mozilla/5.0 (compatible; hosaka/1.0; +https://github.com/plus8bit/deadchannel)";

export interface WebResult {
  facts: WebFacts;
  html: string;
}

export async function collectWeb(domain: string, timeoutMs = 10_000): Promise<WebResult> {
  const res = await fetch(`https://${domain}`, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const html = await readCapped(res);

  return {
    facts: {
      status: res.status,
      finalUrl: res.url || null,
      title: extract(html, /<title[^>]*>([\s\S]{1,300}?)<\/title>/i),
      description: extract(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]{1,400}?)["']/i),
      server: res.headers.get("server"),
      poweredBy: res.headers.get("x-powered-by"),
      hsts: res.headers.has("strict-transport-security"),
      htmlBytes: Buffer.byteLength(html),
    },
    html,
  };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Buffer.from(value));
        total += value.byteLength;
      }
    }
  } catch {
    // A truncated read still fingerprints fine.
  } finally {
    void reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extract(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  if (!m?.[1]) return null;
  return m[1]
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
