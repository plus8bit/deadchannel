/**
 * Separating a company's own contact points from everything else on its pages.
 *
 * A scraper reads every address it can reach and cannot tell which ones belong
 * to the company. Asking for stripe.com returns Stripe's sales and support
 * addresses alongside a partner's support desk, a developer's personal gmail
 * and `example@gmail.com` from a documentation snippet — because all of them
 * appear on pages under stripe.com.
 *
 * Sorting them is the whole reason a buyer should pay us rather than the
 * scraper directly. Nothing is thrown away: an address on the company's pages
 * that belongs to someone else is often the interesting one — it names a
 * partner, a vendor, a person — so it is moved, not deleted.
 */

export interface ContactSummary {
  /** Addresses at the company's own domain. What "contact this company" means. */
  emails: string[];
  /** Phone numbers published on the company's own pages. */
  phones: string[];
  /** Social accounts, as returned. */
  social: Record<string, string>;
  /**
   * Addresses found on the company's pages that belong to someone else —
   * partners, vendors, individuals, documentation examples.
   */
  foundElsewhere: string[];
  /** How many of the raw addresses survived, so the filtering is auditable. */
  kept: number;
  discarded: number;
}

/** Does an address belong to this company: same domain, or a subdomain of it. */
function ownedBy(email: string, domain: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const host = email.slice(at + 1).toLowerCase();
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
}

/**
 * The host a source URL really points at.
 *
 * Marketing mail wraps its links: a stripe.com tracking host carrying an
 * encoded external URL is not a page on stripe.com, and the phone number on it
 * belongs to whoever is on the other side of the redirect.
 */
function sourceHost(url: string): string | null {
  try {
    const u = new URL(url);
    const embedded = decodeURIComponent(u.pathname + u.search).match(/https?:\/\/([^/\s]+)/);
    return (embedded ? embedded[1]! : u.hostname).toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function onOwnSite(sources: unknown, domain: string): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  const d = domain.toLowerCase().replace(/^www\./, "");
  return sources.some((s) => {
    const host = typeof s === "string" ? sourceHost(s) : null;
    return host !== null && (host === d || host.endsWith(`.${d}`));
  });
}

/** Reads {value, sources} rows without trusting the supplier's shape. */
function rows(v: unknown): { value: string; sources: unknown }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    if (typeof r === "string") return [{ value: r, sources: [] }];
    if (r && typeof r === "object" && typeof (r as { value?: unknown }).value === "string") {
      return [{ value: (r as { value: string }).value, sources: (r as { sources?: unknown }).sources }];
    }
    return [];
  });
}

const SOCIAL = ["facebook", "instagram", "twitter", "linkedin", "github", "youtube", "tiktok", "pinterest", "snapchat"];

export function summarise(domain: string, raw: unknown): ContactSummary | null {
  const outer = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(outer["data"]) ? (outer["data"] as unknown[]) : [];
  const first = (list[0] ?? null) as Record<string, unknown> | null;
  if (!first) return null;

  const emails = rows(first["emails"]);
  const mine = emails.filter((e) => ownedBy(e.value, domain)).map((e) => e.value);
  const theirs = emails.filter((e) => !ownedBy(e.value, domain)).map((e) => e.value);

  const social: Record<string, string> = {};
  for (const k of SOCIAL) {
    const v = first[k];
    if (typeof v === "string" && v.length > 0) social[k] = v;
  }

  return {
    emails: [...new Set(mine)],
    phones: [...new Set(rows(first["phone_numbers"]).filter((p) => onOwnSite(p.sources, domain)).map((p) => p.value))],
    social,
    foundElsewhere: [...new Set(theirs)],
    kept: new Set(mine).size,
    discarded: new Set(theirs).size,
  };
}
