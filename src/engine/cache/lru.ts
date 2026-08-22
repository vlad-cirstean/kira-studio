export interface ByteLruEntryMeta {
  connectionId: string;
  path: string;
  label: string;
}

interface Entry<V> {
  value: V;
  bytes: number;
  at: number;
  meta: ByteLruEntryMeta;
}

/**
 * Byte-budgeted LRU, insertion-order via a `Map` (JS `Map` iterates insertion order; `get`
 * re-inserts to touch — no linked list, no library). Backs L2 (§6b) and is generic enough that
 * L3 (§6c) could reuse it, though L3 is unbudgeted and small enough not to need it.
 */
export class ByteLru<V> {
  private budget: number;
  private totalBytes = 0;
  private readonly entries_ = new Map<string, Entry<V>>();

  constructor(budgetBytes: number) {
    this.budget = budgetBytes;
  }

  get budgetBytes(): number {
    return this.budget;
  }

  setBudget(bytes: number): void {
    this.budget = bytes;
    this.evictToBudget();
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries_.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries_.get(key);
    if (!entry) return undefined;
    // Touch: re-insert at the newest end.
    this.entries_.delete(key);
    this.entries_.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, bytes: number, meta: ByteLruEntryMeta): void {
    // An entry larger than half the budget is not cached at all — one 40 MB page must not
    // evict every other page in a 64 MB budget.
    if (bytes > this.budget / 2) {
      console.warn(
        `[engine] cache: refusing to store ${meta.label} (${bytes} bytes exceeds half the ` +
          `${this.budget}-byte budget)`,
      );
      return;
    }
    const existing = this.entries_.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries_.delete(key);
    }
    this.entries_.set(key, { value, bytes, at: Date.now(), meta });
    this.totalBytes += bytes;
    this.evictToBudget();
  }

  deleteWhere(pred: (meta: ByteLruEntryMeta) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries_) {
      if (pred(entry.meta)) {
        this.entries_.delete(key);
        this.totalBytes -= entry.bytes;
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries_.clear();
    this.totalBytes = 0;
  }

  entries(): { key: string; bytes: number; at: number; meta: ByteLruEntryMeta }[] {
    return [...this.entries_.entries()].map(([key, entry]) => ({
      key,
      bytes: entry.bytes,
      at: entry.at,
      meta: entry.meta,
    }));
  }

  private evictToBudget(): void {
    for (const [key, entry] of this.entries_) {
      if (this.totalBytes <= this.budget) break;
      this.entries_.delete(key);
      this.totalBytes -= entry.bytes;
    }
  }
}
