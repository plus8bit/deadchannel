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
 * Priced against the companies actually selling company enrichment, not the
 * pricier people-data tier: the field runs $0.02 to $0.075 with a $0.068
 * median. The dossier sits just under the closest comparable by content, and
 * the look-up stays in the cheapest tier because its job is to collect distinct
 * payers, which is the only thing the catalog ranks on.
 */
export const PRICE_LOOKUP = 0.01;
export const PRICE_DOSSIER = 0.07;
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
    "Fast company look-up from a domain: age, registrar, mail and DNS provider, DMARC, HTTPS, and how many third-party vendors we can see. One call, no signup, no API key.",
  tags: ["company-data", "enrichment", "domain", "b2b", "technographics"],
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
    "Full company dossier from a domain: every third-party vendor we can prove they use, with the DNS record or script that proves it, plus registration, mail, certificate and site facts. Technographics without a subscription.",
  tags: ["technographics", "company-data", "vendor-stack", "b2b", "enrichment"],
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
