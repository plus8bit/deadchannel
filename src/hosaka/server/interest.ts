/**
 * Who asked, and about what.
 *
 * Vercel already counts requests per path, so the count of previews needs no
 * code. What the count cannot say is whether a preview was ours. Every domain
 * in this file has been typed into the box by us, in a test, a demo or a
 * screenshot, and counting those as interest would manufacture the very number
 * the measurement exists to find.
 *
 * Nothing here identifies a person: no address, no wallet, no user agent. The
 * domain is already the request body, and the source is a header our own page
 * sets on itself.
 */

/** Domains that appear in our tests, demo scripts and landing copy. */
export const OUR_DOMAINS: readonly string[] = [
  "example.com",
  "figma.com",
  "stripe.com",
  "cloudinary.com",
  "coinbase.com",
  "vercel.com",
  "hosaka-agents.vercel.app",
  "stableenrich.dev",
  "onesource.io",
];

export type PreviewLog = { msg: "preview"; domain: string; via: string; self?: true };

/**
 * One line per free preview. `self` marks our own traffic rather than dropping
 * it, because a filter applied at write time cannot be undone at read time.
 */
export function previewLog(domain: string, src: string | undefined): PreviewLog {
  const clean = domain.trim().toLowerCase().replace(/^www\./, "");
  const via = src === "landing" || src === "mcp" ? src : "api";
  const ours = OUR_DOMAINS.includes(clean);
  return ours ? { msg: "preview", domain: clean, via, self: true } : { msg: "preview", domain: clean, via };
}
