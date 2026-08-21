import type { DnsFacts } from "../types.ts";

/**
 * DNS over HTTPS. No key, no account, no rate limit worth worrying about.
 *
 * Cloudflare first, Google as the fallback: a profile should not fail because
 * one resolver is having a bad minute.
 */

const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

interface Answer {
  data: string;
  type: number;
}

async function query(name: string, type: string, timeoutMs: number): Promise<Answer[]> {
  for (const base of RESOLVERS) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { Answer?: Answer[] };
      return body.Answer ?? [];
    } catch {
      // Try the next resolver.
    }
  }
  return [];
}

/** Quoted TXT strings arrive chunked at 255 chars; join before matching. */
function unquote(data: string): string {
  return data.replace(/"\s*"/g, "").replace(/^"|"$/g, "");
}

export async function collectDns(domain: string, timeoutMs = 6000): Promise<DnsFacts> {
  const [a, mx, ns, txt, dmarcTxt] = await Promise.all([
    query(domain, "A", timeoutMs),
    query(domain, "MX", timeoutMs),
    query(domain, "NS", timeoutMs),
    query(domain, "TXT", timeoutMs),
    query(`_dmarc.${domain}`, "TXT", timeoutMs),
  ]);

  const txtValues = txt.map((r) => unquote(r.data));

  return {
    a: a.map((r) => r.data),
    // MX arrives as "10 mail.example.com." — keep the host, drop priority and dot.
    mx: mx.map((r) => r.data.replace(/^\d+\s+/, "").replace(/\.$/, "")),
    ns: ns.map((r) => r.data.replace(/\.$/, "")),
    txtCount: txtValues.length,
    spf: txtValues.find((v) => v.toLowerCase().startsWith("v=spf1")) ?? null,
    dmarc: dmarcTxt.map((r) => unquote(r.data)).find((v) => v.toLowerCase().startsWith("v=dmarc1")) ?? null,
  };
}

/** Raw TXT values, kept separate because vendor detection needs all of them. */
export async function collectTxt(domain: string, timeoutMs = 6000): Promise<string[]> {
  return (await query(domain, "TXT", timeoutMs)).map((r) => unquote(r.data));
}
