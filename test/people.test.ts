import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarisePeople } from "../src/hosaka/people.ts";

/** The shape of a real purchase from FullEnrich, trimmed to what we read. */
const RAW = {
  people: [
    {
      full_name: "Wilfried Baah",
      first_name: "Wilfried",
      last_name: "Baah",
      headline: "Technical Account Manager @ Stripe",
      description: "a paragraph the buyer can read in the raw payload",
      location: { country: "United States", country_code: "US", city: "New York", region: "New York" },
      social_profiles: {
        professional_network: { url: "https://www.linkedin.com/in/wilfried-baah-b5914727" },
      },
      skills: ["Access", "C++", "Microsoft Excel"],
    },
  ],
};

describe("reading a people-data response", () => {
  it("lifts the four things a buyer looks for first", () => {
    const s = summarisePeople(RAW)!;
    assert.equal(s.count, 1);
    assert.deepEqual(s.people[0], {
      name: "Wilfried Baah",
      headline: "Technical Account Manager @ Stripe",
      location: "New York, United States",
      profile: "https://www.linkedin.com/in/wilfried-baah-b5914727",
    });
  });

  it("does not repeat a region that is just the country again", () => {
    // "New York, New York, United States" reads as a bug, not as detail.
    const s = summarisePeople({
      people: [{ full_name: "A", location: { city: "Paris", region: "Paris", country: "France" } }],
    })!;
    assert.equal(s.people[0]!.location, "Paris, France");
  });

  it("builds a name from the halves when the whole is missing", () => {
    const s = summarisePeople({ people: [{ first_name: "Ada", last_name: "Lovelace" }] })!;
    assert.equal(s.people[0]!.name, "Ada Lovelace");
  });

  it("skips rows with no name rather than emitting blanks", () => {
    const s = summarisePeople({ people: [{ headline: "someone" }, { full_name: "Real Person" }] })!;
    assert.deepEqual(s.people.map((p) => p.name), ["Real Person"]);
  });

  it("survives a supplier that changes shape", () => {
    // No schema is published, so the response may move. An unreadable shape
    // must leave the raw payload readable rather than throw.
    assert.equal(summarisePeople({}), null);
    assert.equal(summarisePeople(null), null);
    assert.equal(summarisePeople({ people: "not a list" }), null);
  });
});

describe("the decision-makers shelf", () => {
  it("asks the supplier only for people who can sign", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const levels = TIERS.executives.seniority;
    // The list came from the supplier's own validator, which enumerated every
    // option it accepts when sent an invalid one — for nothing.
    assert.deepEqual([...levels], ["Owner", "Founder", "C-level", "Partner", "VP", "Head", "Director"]);
    // Manager and Senior describe people who carry out a decision, not make it.
    assert.ok(!levels.includes("Manager" as never));
    assert.ok(!levels.includes("Senior" as never));
  });

  it("costs the same to buy as the unfiltered shelf, and sells for more", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const { SUPPLIERS } = await import("../src/hosaka/suppliers/types.ts");
    assert.equal(TIERS.executives.supplier, TIERS.people.supplier, "same purchase, filtered");
    // The premium is not for more data. It is for less of it, chosen.
    assert.ok(TIERS.executives.priceUsd > TIERS.people.priceUsd);
    assert.ok(TIERS.executives.priceUsd > SUPPLIERS[TIERS.executives.supplier]!.maxPriceUsd);
  });

  it("keeps the two people shelves distinguishable in the response", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    assert.notEqual(TIERS.executives.kind, TIERS.people.kind);
  });
});
