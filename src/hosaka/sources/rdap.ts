import type { RegistrationFacts } from "../types.ts";

/**
 * Registration data straight from the authoritative registry via RDAP.
 *
 * rdap.org redirects to whichever registry owns the TLD, so redirects must be
 * followed. Free, keyless, and authoritative — this is the same record a paid
 * WHOIS API resells.
 */

interface RdapEvent {
  eventAction: string;
  eventDate: string;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, unknown[][]];
}

/**
 * Where to ask. rdap.org is a convenient redirector but it does not know every
 * TLD and it goes down; IANA publishes the authoritative map of TLD to registry,
 * which covers what rdap.org misses.
 */
async function endpoints(domain: string, timeoutMs: number): Promise<string[]> {
  const urls = [`https://rdap.org/domain/${encodeURIComponent(domain)}`];
  const tld = domain.split(".").pop() ?? "";
  try {
    const res = await fetch("https://data.iana.org/rdap/dns.json", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const dns = (await res.json()) as { services?: [string[], string[]][] };
      for (const [tlds, servers] of dns.services ?? []) {
        if (!tlds.includes(tld)) continue;
        for (const server of servers) {
          urls.push(`${server.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`);
        }
      }
    }
  } catch {
    // Bootstrap unavailable; rdap.org alone will have to do.
  }
  return urls;
}

export async function collectRegistration(
  domain: string,
  timeoutMs = 8000,
): Promise<RegistrationFacts> {
  let lastError = "no rdap endpoint answered";
  let body: {
    events?: RdapEvent[];
    entities?: RdapEntity[];
    status?: string[];
  } | null = null;

  for (const url of await endpoints(domain, timeoutMs)) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/rdap+json" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `${new URL(url).host} returned ${res.status}`;
        continue;
      }
      body = (await res.json()) as typeof body;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!body) throw new Error(lastError);

  const parsed = body as {
    events?: RdapEvent[];
    entities?: RdapEntity[];
    status?: string[];
  };

  const events = new Map((parsed.events ?? []).map((e) => [e.eventAction, e.eventDate]));
  const registered = events.get("registration") ?? null;

  return {
    registered,
    expires: events.get("expiration") ?? null,
    registrar: registrarName(parsed.entities ?? []),
    status: parsed.status ?? [],
    ageYears: registered ? yearsSince(registered) : null,
  };
}

function registrarName(entities: RdapEntity[]): string | null {
  const registrar = entities.find((e) => e.roles?.includes("registrar"));
  const vcard = registrar?.vcardArray?.[1] ?? [];
  const fn = vcard.find((entry) => Array.isArray(entry) && entry[0] === "fn");
  return Array.isArray(fn) && typeof fn[3] === "string" ? fn[3] : null;
}

function yearsSince(iso: string): number | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / (365.25 * 86_400_000));
}
