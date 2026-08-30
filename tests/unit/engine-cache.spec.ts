import { describe, expect, test } from 'bun:test';
import { countEntryCount, putCount } from '../../src/engine/cache/counts';
import { ByteLru } from '../../src/engine/cache/lru';
import {
  clearPages,
  configurePageBudget,
  getPage,
  pageStats,
  putPage,
} from '../../src/engine/cache/pages';
import type { ReadRequestWire } from '../../src/shared/protocol/data-ops';
import type { Page } from '../../src/shared/protocol/page';

// New this session (P57 M5, budgets/perf/leaks port) — direct, dependency-free coverage of
// `src/engine/cache/{lru,pages,counts}.ts`, replacing the only two things that ever exercised
// them: `tests/e2e/perf.spec.ts`'s "L2 budget: never exceeded" check and `tests/e2e/leaks.spec.ts`'s
// "L3 is bounded" / "clearing the cache resets the hit rate" checks. Neither ports into
// `tests/ui/` — see `tests/ui/perf.spec.ts`'s and `tests/ui/leaks.spec.ts`'s own header comments
// for the full reasoning: the byte-budget cache these three checks exercise lives inside the real
// `engine` child process, which this repo's mocked UI tier does not run at all, so a mock answering
// `DATA_OP.cacheStats`/`DATA_OP.count` could only echo a hand-picked number — not a real test of the
// eviction algorithm. Testing `ByteLru`/`pages.ts`/`counts.ts` directly is not merely a replacement
// for that lost coverage; it is a *more* precise test of the actual subject (the exact 2 048-entry
// bound, not "<= 2100 with slack for a live Postgres round trip's timing"), with no browser, no
// mock and no Docker needed to run it (`bun test tests/unit`).

describe('ByteLru', () => {
  test('evicts oldest entries once the budget is exceeded', () => {
    const lru = new ByteLru<string>(100);
    const meta = { connectionId: 'c', path: 'p', label: '' };
    lru.set('a', 'a', 40, meta);
    lru.set('b', 'b', 40, meta);
    lru.set('c', 'c', 40, meta); // 120 > 100 — evicts 'a' (oldest)
    expect(lru.bytes).toBeLessThanOrEqual(100);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe('b');
    expect(lru.get('c')).toBe('c');
  });

  test('get() touches an entry, moving it to the newest end', () => {
    const lru = new ByteLru<string>(100);
    const meta = { connectionId: 'c', path: 'p', label: '' };
    lru.set('a', 'a', 40, meta);
    lru.set('b', 'b', 40, meta);
    lru.get('a'); // touch — 'a' is now newer than 'b'
    lru.set('c', 'c', 40, meta); // 120 > 100 — evicts the now-oldest, 'b', not 'a'
    expect(lru.get('a')).toBe('a');
    expect(lru.get('b')).toBeUndefined();
  });

  test('an entry larger than half the budget is refused outright, not stored', () => {
    const lru = new ByteLru<string>(100);
    const meta = { connectionId: 'c', path: 'p', label: 'huge' };
    lru.set('huge', 'huge', 51, meta); // > 100/2
    expect(lru.get('huge')).toBeUndefined();
    expect(lru.bytes).toBe(0);
    expect(lru.size).toBe(0);
  });

  test('deleteWhere removes only matching entries and updates bytes/size', () => {
    const lru = new ByteLru<string>(1000);
    lru.set('a', 'a', 10, { connectionId: 'conn1', path: 'p1', label: '' });
    lru.set('b', 'b', 10, { connectionId: 'conn2', path: 'p2', label: '' });
    const removed = lru.deleteWhere((meta) => meta.connectionId === 'conn1');
    expect(removed).toBe(1);
    expect(lru.size).toBe(1);
    expect(lru.bytes).toBe(10);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe('b');
  });

  test('setBudget shrinks the store to fit a lower budget immediately', () => {
    const lru = new ByteLru<string>(1000);
    lru.set('a', 'a', 400, { connectionId: 'c', path: 'p', label: '' });
    lru.set('b', 'b', 400, { connectionId: 'c', path: 'p', label: '' });
    lru.setBudget(500); // 800 > 500 — evicts 'a' (oldest) until under budget
    expect(lru.bytes).toBeLessThanOrEqual(500);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe('b');
  });
});

describe('L2 page cache (src/engine/cache/pages.ts)', () => {
  // pages.ts's putPage/getPage are module-level singletons — every test starts from a clean slate
  // rather than relying on file-load order.
  function fakeReq(connectionId: string, path: string): ReadRequestWire {
    // putPage only reads req.connectionId/req.path (pages.ts's own putPage body) — a full
    // ReadRequestWire is not needed to exercise it.
    return { connectionId, path } as unknown as ReadRequestWire;
  }
  function fakePage(byteSize: number): Page {
    // putPage only reads page.byteSize — same reasoning as fakeReq above.
    return { byteSize } as unknown as Page;
  }

  test('never exceeds its configured budget after eviction', () => {
    clearPages();
    // Same mechanism `tests/e2e/perf.spec.ts`'s original L2 check drove indirectly (twenty
    // distinct pages, some real workload's page bytes) — here configured tight and direct.
    const req = fakeReq('conn', 'database:kira_test/schema:app/table:big_rows');
    const previousBudget = pageStats().budgetBytes;
    // A small budget makes the eviction boundary reachable with a handful of entries instead of
    // needing megabytes of fake page data.
    configurePageBudget(1000);
    for (let i = 0; i < 20; i++) {
      putPage(`key-${i}`, `label-${i}`, req, fakePage(200));
    }
    expect(pageStats().bytes).toBeLessThanOrEqual(1000);
    expect(pageStats().entries).toBeLessThan(20);
    configurePageBudget(previousBudget); // restore, since this module is process-global
    clearPages();
  });

  test('clearPages() resets the hit/miss counters (Settings → Cache "Clear caches", F20/D20)', () => {
    clearPages();
    const req = fakeReq('conn', 'database:kira_test/schema:app/table:order_items');
    putPage('k1', 'label', req, fakePage(10));
    getPage('k1'); // a real hit
    getPage('missing-key'); // a real miss
    const before = pageStats();
    expect(before.hits).toBeGreaterThan(0);
    expect(before.misses).toBeGreaterThan(0);

    clearPages();
    const after = pageStats();
    expect(after.hits).toBe(0);
    expect(after.misses).toBe(0);
    expect(after.entries).toBe(0);
    expect(after.bytes).toBe(0);
  });
});

describe('L3 count cache (src/engine/cache/counts.ts)', () => {
  test('is bounded at exactly 2 048 entries (256 KiB budget / 128 B nominal entry, P13 D19)', () => {
    // Mirrors tests/e2e/leaks.spec.ts's own "L3 is bounded" scenario, but exact rather than
    // "<= 2100 with slack" — no real network timing noise to allow for here.
    const COMBOS = 2500;
    for (let i = 0; i < COMBOS; i++) {
      putCount(
        'conn',
        'database:kira_test/schema:app/table:order_items',
        `(1=1) OR (0=${i})`,
        3,
        true,
      );
    }
    expect(countEntryCount()).toBe(2048);
  });
});
