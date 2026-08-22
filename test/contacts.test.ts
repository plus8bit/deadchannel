import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarise } from "../src/hosaka/contacts.ts";

/**
 * The fixture is a real response, captured from a real $0.003 purchase against
 * stripe.com. Its value is that a scraper's actual failure modes are stranger
 * than invented ones: a documentation example, a developer's personal gmail and
 * a partner's support desk all arrived as "contacts for stripe.com".
 */
const RAW = JSON.parse(readFileSync(new URL("./fixtures/contacts-stripe.json", import.meta.url), "utf8"));

describe("sorting a company's contacts from everything else on its pages", () => {
  it("keeps only addresses at the company's own domain", () => {
    const s = summarise("stripe.com", RAW)!;
    assert.deepEqual(s.emails, [
      "sales@stripe.com",
      "support@stripe.com",
      "dpo@stripe.com",
      "trademarks@stripe.com",
    ]);
  });

  it("moves the rest instead of deleting them", () => {
    const s = summarise("stripe.com", RAW)!;
    // A partner's address on a company's own marketplace page is a fact about
    // that company, just not a way to contact it. Discarding it would throw
    // away the more interesting half of what we bought.
    assert.ok(s.foundElsewhere.includes("support@postmarkapp.com"));
    assert.ok(s.foundElsewhere.includes("example@gmail.com"));
    assert.equal(s.kept + s.discarded, 9);
  });

  it("does not count a redirect through the company's domain as its own page", () => {
    const s = summarise("stripe.com", RAW)!;
    // The number sat on 59.email.stripe.com — a tracking host — but the URL
    // carried an encoded link to icacities.org, whose phone number it is.
    assert.deepEqual(s.phones, ["8889262289"]);
  });

  it("counts a subdomain as the company", () => {
    const s = summarise("stripe.com", {
      data: [{ emails: [{ value: "a@mail.stripe.com", sources: [] }] }],
    })!;
    assert.deepEqual(s.emails, ["a@mail.stripe.com"]);
  });

  it("sets aside addresses that exist only to be looked at", () => {
    // Real string, real domain, real page — a support article explaining what a
    // generated address looks like. Every test a scraper applies says contact.
    const s = summarise("stripe.com", {
      data: [
        {
          emails: [
            { value: "sales@stripe.com", sources: [] },
            { value: "acct_1234abcd@stripe.com", sources: [] },
            { value: "cus_9f2b1@stripe.com", sources: [] },
            { value: "yourname@stripe.com", sources: [] },
          ],
        },
      ],
    })!;
    assert.deepEqual(s.emails, ["sales@stripe.com"]);
    assert.equal(s.likelyPlaceholder.length, 3);
  });

  it("does not mistake a person for a placeholder", () => {
    // An underscore is not the signal; a digit-bearing identifier after it is.
    // Getting this wrong buries a real contact, so the rule stays narrow.
    const s = summarise("stripe.com", {
      data: [
        {
          emails: [
            { value: "john_smith@stripe.com", sources: [] },
            { value: "anna.petrova@stripe.com", sources: [] },
            { value: "team2024@stripe.com", sources: [] },
          ],
        },
      ],
    })!;
    assert.equal(s.likelyPlaceholder.length, 0);
    assert.equal(s.emails.length, 3);
  });

  it("survives a supplier that changes shape", () => {
    // The supplier publishes no schema, so it is free to return anything. A
    // shape we cannot read must leave the raw data readable, not throw.
    assert.equal(summarise("stripe.com", {}), null);
    assert.equal(summarise("stripe.com", null), null);
    assert.deepEqual(summarise("stripe.com", { data: [{ emails: ["b@stripe.com"] }] })!.emails, ["b@stripe.com"]);
  });
});
