import { buildProfile, normalize } from "../profile.ts";
import { providerFor } from "../vendors.ts";
import { MemoryStore, costPerSale } from "../store.ts";
import type { DomainProfile } from "../types.ts";
import { BadInput } from "../../server/paid.ts";
import type { PaidRoute } from "../../server/x402.ts";

/**
 * Hosaka's shelves.
 *
 * Two SKUs on purpose. The catalog ranks by unique payers and ignores the query
 * text entirely, so a cheap item that many different agents try once is the only
 * way onto the chart; the dossier is what the chart is for.
 */

/**
 * Priced against what an agent actually finds when it searches the catalog for
 * the same thing, measured rather than assumed.
 *
 * Searching the Bazaar for technology-stack detection returns fourteen sellers,
 * and BuiltWith — the twenty-year incumbent whose name a buyer already trusts —
 * answers the same question at $0.050. Holding $0.070 above them asks an agent
 * to pay a premium for the brand it has never heard of. The dossier costs us
 * nothing to produce, because it reads public DNS, so the one advantage we can
 * hold for as long as we like is being cheaper than sellers who have costs.
 *
 * The look-up drops to what the catalog was already advertising for it, which
 * removes a mismatch and costs almost nothing: its job is to collect distinct
 * payers, and unique payers are what the ranking counts.
 */
export const PRICE_LOOKUP = 0.005;
export const PRICE_DOSSIER = 0.04;
/** Registration and DNS move slowly; a day-old profile is still a true one. */
const TTL_MS = 24 * 60 * 60 * 1000;

const warehouse = new MemoryStore<DomainProfile>({ maxItems: 5000 });

export interface DomainRequest {
  domain: string;
}

export function parseDomainRequest(body: unknown): DomainRequest {
  if (typeof body !== "object" || body === null) throw new BadInput("body must be a JSON object");
  const raw = (body as Record<string, unknown>)["domain"];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BadInput("`domain` is required, e.g. {\"domain\":\"figma.com\"}");
  }
  let domain: string;
  try {
    domain = normalize(raw);
  } catch (err) {
    throw new BadInput(err instanceof Error ? err.message : "unusable domain");
  }
  if (!domain.includes(".") || domain.length > 253) throw new BadInput(`not a domain: ${raw}`);
  if (isPrivateHost(domain)) throw new BadInput("`domain` must be a public host");
  return { domain };
}

/** Keeps the shop from being used to probe someone's internal network. */
function isPrivateHost(host: string): boolean {
  if (/^(localhost|.*\.(localhost|internal|local|home|lan))$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Fetches from the warehouse, restocking only when the shelf is empty. */
async function stocked(domain: string): Promise<{ profile: DomainProfile; fromWarehouse: boolean }> {
  const held = await warehouse.get(domain);
  if (held) {
    await warehouse.recordSale(domain);
    return { profile: held.value, fromWarehouse: true };
  }
  const profile = await buildProfile(domain);
  await warehouse.put(domain, profile, { ttlMs: TTL_MS, costUsd: profile.costUsd });
  await warehouse.recordSale(domain);
  return { profile, fromWarehouse: false };
}

// ── SKU 1: the cheap look-up that gets us onto the chart ────────────────────

export interface LookupResponse {
  domain: string;
  ageYears: number | null;
  registrar: string | null;
  mailProvider: string | null;
  dnsProvider: string | null;
  dmarc: boolean;
  https: boolean;
  title: string | null;
  vendorCount: number;
  collectedAt: string;
}

export async function runLookup(req: DomainRequest): Promise<LookupResponse> {
  const { profile } = await stocked(req.domain);
  return {
    domain: profile.domain,
    ageYears: profile.registration?.value.ageYears ?? null,
    registrar: profile.registration?.value.registrar ?? null,
    // Asked of the records directly: the deduplicated vendor list keeps only
    // the strongest evidence per vendor, which loses the MX/NS attribution.
    mailProvider: providerFor("mx", profile.dns?.value.mx ?? []),
    dnsProvider: providerFor("ns", profile.dns?.value.ns ?? []),
    dmarc: Boolean(profile.dns?.value.dmarc),
    https: Boolean(profile.tls),
    title: profile.web?.value.title ?? null,
    vendorCount: profile.vendors.length,
    collectedAt: profile.collectedAt,
  };
}

// ── SKU 2: the dossier, which is what the cheap one advertises ──────────────

export async function runDossier(req: DomainRequest): Promise<DomainProfile> {
  const { profile } = await stocked(req.domain);
  return profile;
}

/**
 * A free taste, sized to be worth having and not worth stealing.
 *
 * The paid product is the vendor list with the record proving each entry. This
 * gives the shape of that list — how many, in which categories, and two names —
 * and no evidence at all, so it answers "is there anything here for me" without
 * answering "which record proves it". A count nobody can verify is an
 * advertisement; the proof is the thing being sold.
 *
 * Domain-specific on purpose: the deck on the landing page used to print
 * identical payment terms whatever you typed, which taught a visitor nothing
 * about their own company.
 */
export async function runPreview(req: DomainRequest) {
  const { profile } = await stocked(req.domain);
  const categories = [...new Set(profile.vendors.map((v) => v.category))].sort();
  return {
    domain: profile.domain,
    vendors: profile.vendors.length,
    categories,
    sample: profile.vendors.slice(0, 2).map((v) => v.name),
    ageYears: profile.registration?.value.ageYears ?? null,
    // Free to produce and the clearest possible demonstration of what this
    // shop does: read the records a company publishes about itself. Naming the
    // provider gives away no evidence — the record proving it stays paid.
    mailProvider: providerFor("mx", profile.dns?.value.mx ?? []),
    dnsProvider: providerFor("ns", profile.dns?.value.ns ?? []),
    free: true,
    full: "POST /dossier returns every vendor with the record that proves it",
  };
}

export function warehouseStats() {
  return warehouse.stats();
}

export { costPerSale };

// ── how each shelf describes itself to the catalog ──────────────────────────

export const LOOKUP_ROUTE: PaidRoute = {
  path: "/lookup",
  method: "POST",
  serviceName: "Hosaka",
  description:
    "Use when you have a company domain and need to know what the company is before spending more. Returns the company name and site title, domain age, registrar, mail provider, DNS provider, DMARC and HTTPS status, and a count of the third-party vendors detected. One call, no signup, no API key. The cheapest way to qualify a domain before buying a fuller record.",
  tags: ["company-data", "enrichment", "domain", "b2b", "firmographics"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"],
  },
  outputExample: {
    domain: "figma.com",
    ageYears: 27,
    registrar: "Amazon Registrar, Inc.",
    mailProvider: "Google Workspace",
    dnsProvider: "AWS Route 53",
    dmarc: true,
    https: true,
    title: "Figma: The collaborative canvas for design, code, and AI",
    vendorCount: 17,
  },
};

export const DOSSIER_ROUTE: PaidRoute = {
  path: "/dossier",
  method: "POST",
  serviceName: "Hosaka",
  description:
    "Use when you need a company's technology and vendor stack from its domain alone. Returns every third-party vendor the company can be proven to use — mail, DNS, CDN, analytics, payments, support, hosting — each with the DNS record or loaded script that proves it, plus registration, certificate and site facts. Technographics without a subscription or a sales call.",
  tags: ["technographics", "vendor-stack", "company-data", "enrichment", "b2b"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"],
  },
  outputExample: {
    domain: "figma.com",
    vendors: [
      { name: "Stripe", category: "payments", evidence: "DNS TXT: stripe-verification=82ce…", confidence: "high" },
      { name: "Greenhouse", category: "hr", evidence: "SPF: include:greenhouse.io", confidence: "high" },
    ],
    registration: { value: { ageYears: 27, registrar: "Amazon Registrar, Inc." }, from: "observed" },
    gaps: [],
  },
};

/**
 * The resale shelf.
 *
 * Priced at $0.25 against a supplier cost of $0.15: cheaper than the market's
 * top earner at $0.28 while carrying strictly more — their contacts plus a
 * company dossier they do not sell. Being both cheaper and fuller than the
 * leader is the only position worth taking from behind.
 */
export const BUNDLE_ROUTE: PaidRoute = {
  path: "/people",
  method: "POST",
  serviceName: "Hosaka",
  description:
    "Use when you need named employees at a company you only know by domain. Returns people who work there with name, job title, seniority, location and profile link, plus the company's proven third-party vendor stack in the same call. B2B lead enrichment and prospecting from a domain, priced per call instead of per seat.",
  tags: ["people-data", "lead-enrichment", "prospecting", "contacts", "b2b"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"],
  },
  outputExample: {
    domain: "figma.com",
    company: { vendors: [{ name: "Greenhouse", category: "hr", evidence: "SPF: include:mg-spf.greenhouse.io" }] },
    contacts: { data: { results: [] }, source: "FullEnrich People Search", kind: "named-people", costUsd: 0.15 },
  },
};

/**
 * The cheap half of the same idea.
 *
 * Same dossier, but the contacts are what the company publishes about itself
 * rather than who works there — scraped from its own site for $0.003 instead
 * of bought from a people-data provider for $0.15. That is a different answer,
 * not a worse version of the same one, so it gets its own shelf and its own
 * price rather than being served quietly when the expensive shelf was paid for.
 *
 * At $0.02 it is also the shelf that works on a small float: thirty of these
 * fit in the wallet space of one call to /people.
 */
/**
 * The shelf a B2B seller actually wants.
 *
 * Same dossier, same supplier and same purchase price as /people, but the
 * people are filtered to the seven seniority levels that can sign something.
 * A list of everyone at a company and a list of the people who decide are not
 * the same product, and the premium is for the second being shorter.
 */
export const EXECUTIVES_ROUTE: PaidRoute = {
  path: "/executives",
  method: "POST",
  serviceName: "Hosaka",
  description:
    "Use when you need the decision makers rather than the whole staff: owners, founders, C-level, partners, VPs, heads and directors, each with title, location and profile link. Also returns the company's proven third-party vendor stack. For finding who can sign a contract at a company you only know by domain.",
  tags: ["decision-makers", "people-data", "sales", "prospecting", "b2b"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"],
  },
  outputExample: {
    domain: "figma.com",
    company: { vendors: [{ name: "Greenhouse", category: "hr", evidence: "SPF: include:mg-spf.greenhouse.io" }] },
    contacts: {
      summary: { count: 1, people: [{ name: "Jane Doe", headline: "VP Engineering", location: "London, United Kingdom", profile: "https://www.linkedin.com/in/…" }] },
      kind: "decision-makers",
      costUsd: 0.15,
    },
  },
};

export const CONTACTS_ROUTE: PaidRoute = {
  path: "/contacts",
  method: "POST",
  serviceName: "Hosaka",
  description:
    "Use when you need to reach a company rather than a named person: the emails, phone numbers and social accounts it publishes about itself, gathered from its own site. Also returns every third-party vendor the company can be proven to use, with the record proving each. For support, sales and abuse contact discovery from a domain.",
  tags: ["contacts", "email-lookup", "company-data", "enrichment", "b2b"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"],
  },
  outputExample: {
    domain: "figma.com",
    company: { vendors: [{ name: "Greenhouse", category: "hr", evidence: "SPF: include:mg-spf.greenhouse.io" }] },
    contacts: {
      data: { emails: ["support@figma.com"], phones: [] },
      source: "OpenWebNinja website contacts scraper",
      kind: "published-contact-points",
      costUsd: 0.003,
    },
  },
};
