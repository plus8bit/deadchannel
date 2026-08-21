/**
 * The warehouse: profiles we have already assembled, kept so the next buyer is
 * served without re-fetching.
 *
 * A caveat that shapes the design: our current sources are free, so this is a
 * latency and rate-limit cache, not yet the compounding-margin asset the plan
 * describes. That only starts once we stock *purchased* facts, and the ledger
 * below is built for it — every entry records what it cost and how many times
 * it has been sold, so the margin on a restocked item is measurable rather
 * than assumed.
 *
 * The default backend lives in memory and dies with the process. On serverless
 * that means it survives only while an instance stays warm. That is honestly
 * worth having and honestly not persistence, which is why `Store` is an
 * interface: a durable backend drops in without touching callers.
 */

export interface StoredItem<T> {
  value: T;
  /** When it entered the warehouse. */
  storedAt: number;
  /** When it stops being sellable. */
  expiresAt: number;
  /** What it cost us to acquire, in USD. Zero for facts we produce ourselves. */
  costUsd: number;
  /** How many times it has been sold since. */
  sold: number;
}

export interface StoreStats {
  items: number;
  sold: number;
  costUsd: number;
  hits: number;
  misses: number;
}

export interface Store<T> {
  get(key: string): Promise<StoredItem<T> | null>;
  put(key: string, value: T, options: { ttlMs: number; costUsd: number }): Promise<void>;
  /** Marks one sale of a stored item, for margin accounting. */
  recordSale(key: string): Promise<void>;
  stats(): Promise<StoreStats>;
}

export interface MemoryStoreOptions {
  /** Hard cap on entries; the oldest are evicted first. */
  maxItems?: number;
  now?: () => number;
}

export class MemoryStore<T> implements Store<T> {
  readonly #items = new Map<string, StoredItem<T>>();
  readonly #maxItems: number;
  readonly #now: () => number;
  #hits = 0;
  #misses = 0;

  constructor(options: MemoryStoreOptions = {}) {
    this.#maxItems = options.maxItems ?? 5000;
    this.#now = options.now ?? Date.now;
  }

  async get(key: string): Promise<StoredItem<T> | null> {
    const item = this.#items.get(key);
    if (!item) {
      this.#misses++;
      return null;
    }
    if (item.expiresAt <= this.#now()) {
      // Expired stock is not stock. Drop it rather than sell a stale fact.
      this.#items.delete(key);
      this.#misses++;
      return null;
    }
    this.#hits++;
    return item;
  }

  async put(key: string, value: T, options: { ttlMs: number; costUsd: number }): Promise<void> {
    const now = this.#now();
    // Re-stocking keeps the sales history: the whole point is watching the
    // per-sale cost fall as an item is sold again and again.
    const previous = this.#items.get(key);
    this.#items.delete(key);
    this.#items.set(key, {
      value,
      storedAt: now,
      expiresAt: now + options.ttlMs,
      costUsd: (previous?.costUsd ?? 0) + options.costUsd,
      sold: previous?.sold ?? 0,
    });
    this.#evict();
  }

  async recordSale(key: string): Promise<void> {
    const item = this.#items.get(key);
    if (item) item.sold++;
  }

  async stats(): Promise<StoreStats> {
    let sold = 0;
    let costUsd = 0;
    for (const item of this.#items.values()) {
      sold += item.sold;
      costUsd += item.costUsd;
    }
    return { items: this.#items.size, sold, costUsd, hits: this.#hits, misses: this.#misses };
  }

  /** Insertion-ordered Map: the first key is the oldest. */
  #evict(): void {
    while (this.#items.size > this.#maxItems) {
      const oldest = this.#items.keys().next();
      if (oldest.done) break;
      this.#items.delete(oldest.value);
    }
  }
}

/**
 * Average cost per sale — the number that says whether the warehouse is
 * working. It falls with every resale of the same item.
 */
export function costPerSale(item: StoredItem<unknown>): number {
  return item.sold === 0 ? item.costUsd : item.costUsd / item.sold;
}
