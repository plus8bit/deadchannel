import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalize } from "../src/hosaka/profile.ts";
import { detectVendors } from "../src/hosaka/vendors.ts";
import type { DnsFacts, WebFacts } from "../src/hosaka/types.ts";

const dns = (over: Partial<DnsFacts> = {}): DnsFacts => ({
  a: [], mx: [], ns: [], txtCount: 0, spf: null, dmarc: null, ...over,
});
const web = (over: Partial<WebFacts> = {}): WebFacts => ({
  status: 200, finalUrl: null, title: null, description: null,
  server: null, poweredBy: null, hsts: false, htmlBytes: 0, ...over,
});

describe("normalize", () => {
  it("accepts a bare domain, a URL, or a www prefix", () => {
    for (const input of ["stripe.com", "https://stripe.com/pricing", "www.stripe.com", "  STRIPE.com "]) {
      assert.equal(normalize(input), "stripe.com", input);
    }
  });

  it("refuses input that is not a domain", () => {
    assert.throws(() => normalize("not a domain at all"));
  });
});

describe("vendor detection", () => {
  it("reads a verification record as proof the company bought the product", () => {
    const found = detectVendors({
      txt: ["anthropic-domain-verification-zk7abc", "docusign=4a93db58-af07"],
      dns: dns(), web: null, html: null,
    });
    assert.deepEqual(found.map((v) => v.name).sort(), ["Anthropic", "Docusign"]);
    assert.ok(found.every((v) => v.confidence === "high"));
  });

  it("reads every sender out of an SPF record, not just the first", () => {
    const found = detectVendors({
      txt: [],
      dns: dns({ spf: "v=spf1 include:_spf.salesforce.com include:sendgrid.net include:spf.mtasv.net ~all" }),
      web: null, html: null,
    });
    assert.deepEqual(found.map((v) => v.name).sort(), ["Postmark", "Salesforce", "SendGrid"]);
  });

  it("identifies the mail and DNS providers from MX and NS", () => {
    const found = detectVendors({
      txt: [],
      dns: dns({ mx: ["aspmx.l.google.com"], ns: ["ns-1087.awsdns-07.org"] }),
      web: null, html: null,
    });
    assert.deepEqual(found.map((v) => v.name).sort(), ["AWS Route 53", "Google Workspace"]);
  });

  it("does not call a logo on a page a vendor the company uses", () => {
    // Notion lists integration logos, including HubSpot's. That is not evidence
    // Notion runs HubSpot, and selling it as such would be selling a wrong fact.
    const found = detectVendors({
      txt: [], dns: dns(), web: web(),
      html: '<img src="/static/agents/tasks/hubspot.svg"><a href="https://stripe.com">Stripe</a>',
    });
    assert.deepEqual(found, [], "a mention is not an integration");
  });

  it("does accept a loaded script as evidence", () => {
    const found = detectVendors({
      txt: [], dns: dns(), web: web(),
      html: '<script src="https://js.hs-scripts.com/123.js"></script><script src="https://js.stripe.com/v3"></script>',
    });
    assert.deepEqual(found.map((v) => v.name).sort(), ["HubSpot", "Stripe"]);
    assert.ok(found.every((v) => v.confidence === "medium"), "page evidence is weaker than DNS");
  });

  it("keeps the stronger evidence when a vendor shows up twice", () => {
    const found = detectVendors({
      txt: ["stripe-verification=82ce"],
      dns: dns(), web: web(),
      html: '<script src="https://js.stripe.com/v3"></script>',
    });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.confidence, "high");
    assert.match(found[0]?.evidence ?? "", /DNS TXT/);
  });

  it("quotes the matching fragment, not the whole page", () => {
    const html = `${"x".repeat(5000)}<script src="https://js.stripe.com/v3"></script>${"y".repeat(5000)}`;
    const found = detectVendors({ txt: [], dns: dns(), web: web(), html });
    assert.ok((found[0]?.evidence.length ?? 0) < 120, "evidence must be checkable by eye");
    assert.match(found[0]?.evidence ?? "", /js\.stripe\.com/);
  });
});
