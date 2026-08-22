import { collectDns, collectTxt } from "./sources/dns.ts";
import { collectRegistration } from "./sources/rdap.ts";
import { collectTls } from "./sources/tls.ts";
import { collectWeb } from "./sources/web.ts";
import { detectVendors } from "./vendors.ts";
import type { DomainProfile, Fact } from "./types.ts";

/**
 * Assembles one company profile from its domain.
 *
 * Every source runs in parallel and is allowed to fail on its own: a company
 * whose certificate is misconfigured still has DNS worth selling. Failures are
 * named in `gaps` rather than swallowed, because a buyer paying for facts needs
 * to know which ones are missing.
 *
 * Cost is zero: every source here is public infrastructure with no key. That is
 * the whole point — the margin is in the assembly, not the raw data.
 */

const FREE = 0;

export interface ProfileOptions {
  timeoutMs?: number;
}

export async function buildProfile(domain: string, options: ProfileOptions = {}): Promise<DomainProfile> {
  const host = normalize(domain);
  const t = options.timeoutMs ?? 9000;
  const gaps: string[] = [];

  const [dns, txt, registration, tls, web] = await Promise.all([
    settle(collectDns(host, t), "dns", gaps),
    settle(collectTxt(host, t), "dns-txt", gaps),
    settle(collectRegistration(host, t), "rdap", gaps),
    settle(collectTls(host, t), "tls", gaps),
    settle(collectWeb(host, t), "web", gaps),
  ]);

  // A page that answered with 403 or 5xx did not tell us anything, even though
  // the fetch itself succeeded. Left unsaid, the buyer infers it from a null
  // title and has to guess whether the company has no title or we were blocked.
  const status = web?.facts.status ?? null;
  if (status !== null && status >= 400) {
    gaps.push(`web: the site answered ${status}, so title, description and page fingerprints are missing`);
  }

  return {
    domain: host,
    collectedAt: new Date().toISOString(),
    dns: fact(dns, "observed", "DNS over HTTPS"),
    registration: fact(registration, "observed", "RDAP registry"),
    tls: fact(tls, "observed", "TLS handshake"),
    web: fact(web?.facts ?? null, "observed", "HTTP response"),
    vendors: detectVendors({
      txt: txt ?? [],
      dns: dns ?? null,
      web: web?.facts ?? null,
      html: web?.html ?? null,
    }),
    gaps,
    costUsd: FREE,
  };
}

async function settle<T>(promise: Promise<T>, name: string, gaps: string[]): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    gaps.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function fact<T>(value: T | null, from: Fact<T>["from"], source: string): Fact<T> | null {
  return value === null ? null : { value, from, source };
}

/** Accepts a bare domain, a URL, or something with a www prefix. */
export function normalize(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw new Error(`not a usable domain: ${input}`);
  }
  return host.replace(/^www\./, "");
}
