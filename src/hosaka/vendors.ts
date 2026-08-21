import type { DnsFacts, Vendor, WebFacts } from "./types.ts";

/**
 * Which third-party services a company demonstrably uses.
 *
 * This is technographics, and vendors charge real money for it. Most of it is
 * sitting in public DNS: a company proves ownership to each SaaS product it
 * buys by placing a verification record, and authorises each sender it uses in
 * its SPF record. Those two lists are a purchase history the company published
 * itself.
 *
 * Evidence is recorded with every hit, so a buyer can check the claim instead
 * of trusting it.
 */

interface Rule {
  name: string;
  category: string;
  /** Matched against a DNS TXT record, an SPF include, an MX host or a script. */
  pattern: RegExp;
}

/** Verification records: a company only places one after buying the product. */
const TXT_RULES: Rule[] = [
  { name: "Google Workspace", category: "productivity", pattern: /google-site-verification/i },
  { name: "Microsoft 365", category: "productivity", pattern: /^ms=|microsoft-domain-verification/i },
  { name: "Atlassian", category: "engineering", pattern: /atlassian-domain-verification/i },
  { name: "Anthropic", category: "ai", pattern: /anthropic-domain-verification/i },
  { name: "OpenAI", category: "ai", pattern: /openai-domain-verification/i },
  { name: "Slack", category: "communication", pattern: /slack-domain-verification/i },
  { name: "Zoom", category: "communication", pattern: /zoom-domain-verification/i },
  { name: "Docusign", category: "legal", pattern: /docusign=/i },
  { name: "Adobe", category: "design", pattern: /adobe-idp-site-verification|adobe-sign-verification/i },
  { name: "Canva", category: "design", pattern: /canva-site-verification/i },
  { name: "Figma", category: "design", pattern: /figma-domain-verification/i },
  { name: "Stripe", category: "payments", pattern: /stripe-verification/i },
  { name: "Facebook / Meta", category: "advertising", pattern: /facebook-domain-verification/i },
  { name: "Apple", category: "platform", pattern: /apple-domain-verification/i },
  { name: "Miro", category: "productivity", pattern: /miro-verification/i },
  { name: "Notion", category: "productivity", pattern: /notion-domain-verification/i },
  { name: "Dropbox", category: "storage", pattern: /dropbox-domain-verification/i },
  { name: "Webex", category: "communication", pattern: /cisco-ci-domain-verification/i },
  { name: "Citrix", category: "it", pattern: /citrix-verification-code/i },
  { name: "Mongo Atlas", category: "engineering", pattern: /mongodb-site-verification/i },
  { name: "Loom", category: "productivity", pattern: /loom-site-verification/i },
  { name: "Klaviyo", category: "marketing", pattern: /klaviyo-site-verification/i },
];

/** SPF includes: every sender the company authorises to email as itself. */
const SPF_RULES: Rule[] = [
  { name: "Google Workspace", category: "email", pattern: /_spf\.google\.com/i },
  { name: "Microsoft 365", category: "email", pattern: /spf\.protection\.outlook\.com/i },
  { name: "Salesforce", category: "crm", pattern: /_spf\.salesforce\.com|_spfblock\.salesforce/i },
  { name: "HubSpot", category: "crm", pattern: /spf\.hubspot|hubspotemail/i },
  { name: "Marketo", category: "marketing", pattern: /mktomail|marketo/i },
  { name: "Mailchimp", category: "marketing", pattern: /spf\.mandrillapp|servers\.mcsv\.net/i },
  { name: "SendGrid", category: "email", pattern: /sendgrid\.net/i },
  { name: "Mailgun", category: "email", pattern: /mailgun\.org/i },
  { name: "Postmark", category: "email", pattern: /spf\.mtasv\.net/i },
  { name: "Amazon SES", category: "email", pattern: /amazonses\.com/i },
  { name: "Zendesk", category: "support", pattern: /mail\.zendesk\.com/i },
  { name: "Intercom", category: "support", pattern: /_spf\.intercom|intercom-mail/i },
  { name: "Freshworks", category: "support", pattern: /freshemail|freshdesk/i },
  { name: "Atlassian", category: "engineering", pattern: /_spf\.atlassian\.net/i },
  { name: "Workday", category: "hr", pattern: /workday\.com/i },
  { name: "Greenhouse", category: "hr", pattern: /greenhouse\.io/i },
  { name: "Docusign", category: "legal", pattern: /spf\.docusign/i },
  { name: "Qualtrics", category: "research", pattern: /qualtrics\.com/i },
  { name: "Braze", category: "marketing", pattern: /braze\.com/i },
  { name: "Customer.io", category: "marketing", pattern: /customeriomail/i },
  { name: "Klaviyo", category: "marketing", pattern: /klaviyomail/i },
];

const MX_RULES: Rule[] = [
  { name: "Google Workspace", category: "email", pattern: /aspmx.*google|googlemail/i },
  { name: "Microsoft 365", category: "email", pattern: /mail\.protection\.outlook/i },
  { name: "Proofpoint", category: "security", pattern: /pphosted|proofpoint/i },
  { name: "Mimecast", category: "security", pattern: /mimecast/i },
  { name: "Zoho Mail", category: "email", pattern: /zoho/i },
  { name: "Fastmail", category: "email", pattern: /messagingengine/i },
  { name: "Barracuda", category: "security", pattern: /barracudanetworks/i },
];

const NS_RULES: Rule[] = [
  { name: "AWS Route 53", category: "cloud", pattern: /awsdns/i },
  { name: "Cloudflare", category: "cloud", pattern: /\.ns\.cloudflare\.com|cloudflare/i },
  { name: "Azure DNS", category: "cloud", pattern: /azure-dns/i },
  { name: "Google Cloud DNS", category: "cloud", pattern: /googledomains|google\.com$/i },
  { name: "NS1", category: "cloud", pattern: /nsone\.net/i },
  { name: "Akamai", category: "cloud", pattern: /akam\.net|akamai/i },
  { name: "DNSimple", category: "cloud", pattern: /dnsimple/i },
  { name: "Vercel", category: "hosting", pattern: /vercel-dns/i },
];

/**
 * Markers left in the served HTML by the products a site embeds.
 *
 * These require a loaded asset — a script src, a CDN host — rather than any
 * mention of the name. A page listing "hubspot.svg" among its integration logos
 * is not a page that uses HubSpot, and selling that as a fact is how a data
 * product loses its buyers.
 */
const WEB_RULES: Rule[] = [
  { name: "Google Analytics", category: "analytics", pattern: /googletagmanager\.com\/gtag|google-analytics\.com\/analytics/i },
  { name: "Segment", category: "analytics", pattern: /cdn\.segment\.(com|io)\//i },
  { name: "Amplitude", category: "analytics", pattern: /cdn\.amplitude\.com|api\.amplitude\.com/i },
  { name: "Mixpanel", category: "analytics", pattern: /cdn\.mxpnl\.com|api\.mixpanel\.com/i },
  { name: "Hotjar", category: "analytics", pattern: /static\.hotjar\.com|script\.hotjar\.com/i },
  { name: "Intercom", category: "support", pattern: /widget\.intercom\.io|js\.intercomcdn\.com/i },
  { name: "Zendesk", category: "support", pattern: /static\.zdassets\.com|ekr\.zdassets\.com/i },
  { name: "Drift", category: "support", pattern: /js\.driftt\.com/i },
  { name: "HubSpot", category: "crm", pattern: /js\.hs-scripts\.com|js\.hsforms\.net|track\.hubspot\.com/i },
  { name: "Stripe", category: "payments", pattern: /js\.stripe\.com\/v\d/i },
  { name: "Shopify", category: "ecommerce", pattern: /cdn\.shopify\.com\/s\/|myshopify\.com/i },
  { name: "Sentry", category: "engineering", pattern: /browser\.sentry-cdn\.com|ingest\.sentry\.io/i },
  { name: "Datadog", category: "engineering", pattern: /datadoghq-browser-agent|browser-intake-datadoghq/i },
  { name: "Next.js", category: "framework", pattern: /\/_next\/static\/|__NEXT_DATA__/i },
  { name: "Vue", category: "framework", pattern: /__VUE__|vue@\d|vue\.runtime/i },
  { name: "WordPress", category: "cms", pattern: /\/wp-content\/|\/wp-includes\//i },
  { name: "Webflow", category: "cms", pattern: /assets\.website-files\.com|webflow\.js/i },
  { name: "Contentful", category: "cms", pattern: /images\.ctfassets\.net|cdn\.contentful\.com/i },
  { name: "Cloudflare", category: "cloud", pattern: /static\.cloudflareinsights\.com|\/cdn-cgi\//i },
];

function match(rules: Rule[], values: string[], label: string, confidence: Vendor["confidence"]): Vendor[] {
  const found: Vendor[] = [];
  for (const rule of rules) {
    for (const value of values) {
      const m = rule.pattern.exec(value);
      if (!m) continue;
      found.push({
        name: rule.name,
        category: rule.category,
        // Quote the fragment that matched, not the haystack. Evidence pointing
        // at 400KB of HTML is not evidence a buyer can check.
        evidence: `${label}: ${excerpt(value, m.index, m[0].length)}`,
        confidence,
      });
      break;
    }
  }
  return found;
}

/** The match plus a little context, so a claim can be verified by eye. */
function excerpt(value: string, index: number, length: number): string {
  if (value.length <= 90) return value;
  const start = Math.max(0, index - 20);
  const end = Math.min(value.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${value.slice(start, end).replace(/\s+/g, " ")}${end < value.length ? "…" : ""}`;
}

export function detectVendors(input: {
  txt: string[];
  dns: DnsFacts | null;
  web: WebFacts | null;
  html: string | null;
}): Vendor[] {
  const found: Vendor[] = [];

  // A verification record is deliberate proof of a business relationship.
  found.push(...match(TXT_RULES, input.txt, "DNS TXT", "high"));

  // SPF names every sender allowed to email as the company. Split the record
  // so one include does not shadow the rest.
  const spfParts = (input.dns?.spf ?? "").split(/\s+/).filter((p) => p.length > 0);
  found.push(...match(SPF_RULES, spfParts, "SPF", "high"));

  found.push(...match(MX_RULES, input.dns?.mx ?? [], "MX", "high"));
  found.push(...match(NS_RULES, input.dns?.ns ?? [], "NS", "high"));

  if (input.html) {
    const headers = [input.web?.server ?? "", input.web?.poweredBy ?? ""].filter(Boolean);
    found.push(...match(WEB_RULES, [input.html, ...headers], "page", "medium"));
  }

  // The same vendor can show up in DNS and on the page; keep the strongest.
  const best = new Map<string, Vendor>();
  for (const v of found) {
    const seen = best.get(v.name);
    if (!seen || (seen.confidence === "medium" && v.confidence === "high")) best.set(v.name, v);
  }
  return [...best.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/**
 * Names the provider behind a set of MX or NS hosts.
 *
 * Deliberately independent of `detectVendors`: that function deduplicates a
 * vendor down to its strongest evidence, which may be a TXT record, and then
 * the answer to "who runs their mail" is no longer in the result. Asking the
 * records directly keeps the answer tied to the question.
 */
export function providerFor(kind: "mx" | "ns", hosts: string[]): string | null {
  if (hosts.length === 0) return null;
  const rules = kind === "mx" ? MX_RULES : NS_RULES;
  for (const rule of rules) {
    if (hosts.some((h) => rule.pattern.test(h))) return rule.name;
  }
  // Unknown provider: name the host rather than pretend there is none.
  return hosts[0] ?? null;
}
