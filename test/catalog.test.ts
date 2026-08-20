import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { auditEntry } from "../src/catalog/audit.ts";
import { __test__normalizeCdp } from "../src/catalog/discovery.ts";

/**
 * Regression guard against under-reading discovery metadata.
 *
 * A published figure once claimed 89.8% of the catalog had no tags. The real
 * number was 40.9%: the loader only looked at `extensions.bazaar.tags` while
 * most publishers put tags on the item root. The bug was invisible because
 * nothing ever asserted the *positive* count — how many entries DO have tags.
 *
 * These expectations are hand-counted from the fixture by walking all three
 * known locations independently of the code under test. If the loader regresses
 * to reading one location, the count drops and this fails.
 */

const RAW = JSON.parse(
  readFileSync(new URL("./fixtures/cdp-catalog-sample.json", import.meta.url), "utf8"),
) as { items: Record<string, unknown>[] };

/** Independent reimplementation used only to derive the expected numbers. */
function handCountTags(item: Record<string, unknown>): boolean {
  const resource = (typeof item["resource"] === "object" && item["resource"] !== null
    ? item["resource"]
    : {}) as Record<string, unknown>;
  const bazaar = (((item["extensions"] as Record<string, unknown>)?.["bazaar"] ??
    {}) as Record<string, unknown>);
  return [item["tags"], resource["tags"], bazaar["tags"]].some(
    (v) => Array.isArray(v) && v.length > 0,
  );
}

describe("catalog metadata detection", () => {
  const entries = RAW.items.map((raw) => __test__normalizeCdp(raw));
  const expectedWithTags = RAW.items.filter(handCountTags).length;

  it("has a fixture worth testing against", () => {
    assert.equal(RAW.items.length, 200);
    assert.ok(expectedWithTags > 100, "fixture must contain plenty of tagged entries");
    assert.ok(expectedWithTags < 200, "fixture must contain untagged entries too");
  });

  it("finds tags wherever the publisher put them", () => {
    const found = entries.filter((e) => e.tags.length > 0).length;
    assert.equal(
      found,
      expectedWithTags,
      `loader found tags on ${found} entries, hand count says ${expectedWithTags}`,
    );
  });

  it("never reports more tagged entries than actually exist", () => {
    for (const [i, entry] of entries.entries()) {
      const raw = RAW.items[i] as Record<string, unknown>;
      if (entry.tags.length > 0) {
        assert.ok(handCountTags(raw), `entry ${i} reported tags that are not in the payload`);
      }
    }
  });

  it("flags no-tags on exactly the entries that lack them", () => {
    const flagged = entries.map((e) => auditEntry(e)).filter((a) => a.flags.includes("no-tags")).length;
    assert.equal(flagged, RAW.items.length - expectedWithTags);
  });

  it("reads the HTTP verb, so POST routes are not probed as dead", () => {
    const withMethod = entries.filter((e) => e.method !== null).length;
    assert.ok(withMethod > 0, "the catalog publishes methods; the loader must read them");
  });

  it("prices entries from the catalog the same way a live probe would", () => {
    const priced = entries.filter((e) => e.accepts.some((o) => o.amountDecimal !== null));
    assert.ok(priced.length > 150, "most entries pay in a known asset and must be priceable");
    for (const e of priced) {
      for (const o of e.accepts) {
        if (o.amountDecimal !== null) {
          assert.ok(o.amountDecimal >= 0 && Number.isFinite(o.amountDecimal));
        }
      }
    }
  });
});
