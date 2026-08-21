/**
 * What Hosaka sells: a profile of a company assembled from its domain.
 *
 * Every field carries where it came from. A buyer paying for facts is entitled
 * to know which are observed, which are inferred, and which we bought — and a
 * warehouse that cannot answer that cannot be audited or priced.
 */

export type Provenance = "observed" | "inferred" | "purchased";

export interface Fact<T> {
  value: T;
  /** How we know: measured directly, deduced, or bought from a supplier. */
  from: Provenance;
  /** Which source produced it, for the receipt. */
  source: string;
}

export interface DnsFacts {
  a: string[];
  mx: string[];
  ns: string[];
  txtCount: number;
  spf: string | null;
  dmarc: string | null;
}

export interface RegistrationFacts {
  registered: string | null;
  expires: string | null;
  registrar: string | null;
  status: string[];
  /** Whole years since registration — the single most requested trust signal. */
  ageYears: number | null;
}

export interface TlsFacts {
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** Other hostnames on the same certificate: siblings, staging, brands. */
  altNames: string[];
}

export interface WebFacts {
  status: number | null;
  finalUrl: string | null;
  title: string | null;
  description: string | null;
  server: string | null;
  poweredBy: string | null;
  hsts: boolean;
  htmlBytes: number;
}

/** A third-party service the company demonstrably uses. */
export interface Vendor {
  name: string;
  category: string;
  /** What gave it away — a DNS record, a script, a header. */
  evidence: string;
  confidence: "high" | "medium";
}

export interface DomainProfile {
  domain: string;
  collectedAt: string;
  dns: Fact<DnsFacts> | null;
  registration: Fact<RegistrationFacts> | null;
  tls: Fact<TlsFacts> | null;
  web: Fact<WebFacts> | null;
  vendors: Vendor[];
  /** Sources that failed, named rather than hidden. */
  gaps: string[];
  /** What this profile cost us to assemble, in USD. */
  costUsd: number;
}
