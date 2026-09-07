package gitsession

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// TestDetailCache_EvictsOldestPastCap proves detailCache's own 64-entry cap (D7), LRU by access —
// a get() on the oldest survivor keeps it alive past a fresh insert that would otherwise evict it.
func TestDetailCache_EvictsOldestPastCap(t *testing.T) {
	c := newDetailCache()
	for i := 0; i < detailCacheCap; i++ {
		c.set(shaFor(i), 0, porcelain.CommitDetail{SHA: shaFor(i)})
	}
	// Touch the oldest entry (index 0) so it is no longer the least-recently-used one.
	if _, ok := c.get(shaFor(0), 0); !ok {
		t.Fatal("expected the oldest entry still present before the cap is exceeded")
	}
	// One more insert past the cap must evict the *new* least-recently-used entry (index 1, since
	// index 0 was just touched), not index 0.
	c.set(shaFor(detailCacheCap), 0, porcelain.CommitDetail{SHA: shaFor(detailCacheCap)})

	if _, ok := c.get(shaFor(0), 0); !ok {
		t.Fatal("index 0 was touched most recently among the originals and must survive eviction")
	}
	if _, ok := c.get(shaFor(1), 0); ok {
		t.Fatal("index 1 was the least-recently-used entry and must have been evicted")
	}
	if len(c.byKey) != detailCacheCap {
		t.Fatalf("cache holds %d entries, want the cap %d", len(c.byKey), detailCacheCap)
	}
}

// TestDetailCache_DropAllClearsEverything proves the refsChanged behaviour (D7) — every entry
// gone, not just the ones whose ref actually moved (there is no per-entry way to know that).
func TestDetailCache_DropAllClearsEverything(t *testing.T) {
	c := newDetailCache()
	c.set("sha1", 0, porcelain.CommitDetail{SHA: "sha1"})
	c.set("sha2", 1, porcelain.CommitDetail{SHA: "sha2"})
	c.dropAll()
	if _, ok := c.get("sha1", 0); ok {
		t.Fatal("sha1 survived dropAll")
	}
	if _, ok := c.get("sha2", 1); ok {
		t.Fatal("sha2 survived dropAll")
	}
	if len(c.byKey) != 0 || len(c.order) != 0 {
		t.Fatalf("cache not empty after dropAll: byKey=%d order=%d", len(c.byKey), len(c.order))
	}
}

func shaFor(i int) string {
	return "sha" + string(rune('a'+i%26)) + string(rune('0'+i/26))
}

// TestDiffCache_EvictsByBytesUnderLRUOrder proves D7's own contrast with the detail cache: capped
// by total bytes, not entry count, and a touched (get) entry survives an eviction pass that would
// otherwise have taken it.
func TestDiffCache_EvictsByBytesUnderLRUOrder(t *testing.T) {
	c := newDiffCache(100)
	c.set("base1", "sha1", "a.txt", porcelain.FileDiffBody{Kind: porcelain.BodyText}, 40)
	c.set("base1", "sha1", "b.txt", porcelain.FileDiffBody{Kind: porcelain.BodyText}, 40)
	if c.total != 80 {
		t.Fatalf("total = %d, want 80", c.total)
	}

	// Touch a.txt so it is no longer the least-recently-used entry.
	if _, _, ok := c.get("base1", "sha1", "a.txt"); !ok {
		t.Fatal("a.txt missing before eviction")
	}

	// A third entry pushes total to 150, over the 100-byte cap — b.txt (now the LRU entry) must be
	// evicted, a.txt (just touched) must survive.
	c.set("base1", "sha1", "c.txt", porcelain.FileDiffBody{Kind: porcelain.BodyText}, 40)

	if _, _, ok := c.get("base1", "sha1", "a.txt"); !ok {
		t.Fatal("a.txt (touched) was evicted, want it to survive")
	}
	if _, _, ok := c.get("base1", "sha1", "b.txt"); ok {
		t.Fatal("b.txt (LRU) survived eviction, want it evicted")
	}
	if _, _, ok := c.get("base1", "sha1", "c.txt"); !ok {
		t.Fatal("c.txt (just inserted) missing")
	}
	if c.total > 100 {
		t.Fatalf("total = %d, want <= 100 after eviction", c.total)
	}
}

// TestDiffCache_NeverInvalidatedByAnythingButEviction proves D7's other half: unlike the detail
// cache, nothing in this package ever calls dropAll on a diff cache — its own clear() exists only
// for RepoEntry.teardown, and a plain set/get round trip is never disturbed by anything but bytes
// pressure.
func TestDiffCache_NeverInvalidatedByAnythingButEviction(t *testing.T) {
	c := newDiffCache(diffCacheCapBytes)
	body := porcelain.FileDiffBody{Kind: porcelain.BodyText}
	c.set("base", "sha", "f.txt", body, 10)
	if _, _, ok := c.get("base", "sha", "f.txt"); !ok {
		t.Fatal("entry missing immediately after set")
	}
	// A root commit's own key (baseSHA == "") is a distinct, valid key, not a collision with any
	// other repo's own empty string.
	c.set("", "root-sha", "f.txt", body, 10)
	if _, _, ok := c.get("", "root-sha", "f.txt"); !ok {
		t.Fatal("root-commit entry (empty baseSha) missing")
	}
	if _, _, ok := c.get("base", "sha", "f.txt"); !ok {
		t.Fatal("original entry evicted by an unrelated set — cache must not cross-invalidate")
	}
}
