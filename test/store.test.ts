import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStore, costPerSale } from "../src/hosaka/store.ts";

/** A clock we control, so expiry is tested rather than waited for. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("warehouse", () => {
  it("serves a stored item back", async () => {
    const s = new MemoryStore<string>();
    await s.put("figma.com", "profile", { ttlMs: 60_000, costUsd: 0 });
    assert.equal((await s.get("figma.com"))?.value, "profile");
  });

  it("misses on an empty shelf", async () => {
    const s = new MemoryStore<string>();
    assert.equal(await s.get("nothing.com"), null);
    assert.deepEqual((await s.stats()).misses, 1);
  });

  it("refuses to sell expired stock", async () => {
    const c = clock();
    const s = new MemoryStore<string>({ now: c.now });
    await s.put("figma.com", "profile", { ttlMs: 1000, costUsd: 0 });

    c.advance(999);
    assert.ok(await s.get("figma.com"), "still fresh a millisecond before expiry");

    c.advance(2);
    assert.equal(await s.get("figma.com"), null, "a stale fact must not be sold");
    assert.equal((await s.stats()).items, 0, "expired stock is dropped, not kept");
  });

  it("counts hits and misses so the cache can be judged", async () => {
    const s = new MemoryStore<string>();
    await s.put("a", "x", { ttlMs: 60_000, costUsd: 0 });
    await s.get("a");
    await s.get("a");
    await s.get("b");
    assert.deepEqual(await s.stats(), { items: 1, sold: 0, costUsd: 0, hits: 2, misses: 1 });
  });

  it("keeps the sales history when an item is restocked", async () => {
    const c = clock();
    const s = new MemoryStore<string>({ now: c.now });
    await s.put("pdl:acme", "contacts", { ttlMs: 1000, costUsd: 0.28 });
    await s.recordSale("pdl:acme");
    await s.recordSale("pdl:acme");

    c.advance(2000);
    await s.put("pdl:acme", "contacts v2", { ttlMs: 1000, costUsd: 0.28 });

    const item = await s.get("pdl:acme");
    assert.equal(item?.sold, 2, "restocking must not erase what we already sold");
    assert.equal(item?.costUsd, 0.56, "both purchases count toward cost");
  });

  it("shows cost per sale falling as an item is resold", async () => {
    const s = new MemoryStore<string>();
    await s.put("pdl:acme", "contacts", { ttlMs: 60_000, costUsd: 0.28 });

    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      await s.recordSale("pdl:acme");
      seen.push(costPerSale((await s.get("pdl:acme")) as never));
    }
    assert.deepEqual(seen.map((n) => Number(n.toFixed(3))), [0.28, 0.14, 0.093, 0.07]);
  });

  it("reports cost per sale as the full cost before anything is sold", () => {
    assert.equal(costPerSale({ value: 1, storedAt: 0, expiresAt: 0, costUsd: 0.28, sold: 0 }), 0.28);
  });

  it("evicts the oldest when the shelf is full", async () => {
    const s = new MemoryStore<string>({ maxItems: 3 });
    for (const k of ["a", "b", "c", "d"]) await s.put(k, k, { ttlMs: 60_000, costUsd: 0 });
    assert.equal(await s.get("a"), null, "oldest is evicted first");
    assert.ok(await s.get("d"));
    assert.equal((await s.stats()).items, 3);
  });

  it("totals what the warehouse cost and what it has sold", async () => {
    const s = new MemoryStore<string>();
    await s.put("a", "x", { ttlMs: 60_000, costUsd: 0.28 });
    await s.put("b", "y", { ttlMs: 60_000, costUsd: 0.15 });
    await s.recordSale("a");
    await s.recordSale("a");
    await s.recordSale("b");
    const st = await s.stats();
    assert.equal(st.sold, 3);
    assert.equal(Number(st.costUsd.toFixed(2)), 0.43);
  });
});
