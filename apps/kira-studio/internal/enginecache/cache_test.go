package enginecache

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// Ported from tests/unit/engine-cache.spec.ts's "L2 page cache" and "L3 count cache" describe
// blocks. Each test builds its own Cache, unlike the TypeScript spec's process-global singleton
// that has to call clearPages()/clearCounts() between cases — the exact reason §4.7 gives for
// making Cache a constructed value here instead of a package-level one.

func fakePage(byteSize int) page.Page {
	return page.TabularPage{ByteSize: byteSize}
}

func TestCache_L2NeverExceedsBudgetAfterEviction(t *testing.T) {
	c := NewCache(1000, nil)
	req := ReadRequest{ConnectionID: "conn", Path: "database:kira_test/schema:app/table:big_rows"}
	for i := 0; i < 20; i++ {
		key, label := PageCacheKey(ReadRequest{ConnectionID: req.ConnectionID, Path: req.Path, Cursor: pageOffsetCursor(i)})
		c.StorePage(key, label, req, fakePage(200))
	}
	stats := c.Stats()
	if stats.L2Bytes > 1000 {
		t.Errorf("L2Bytes = %d, want <= 1000", stats.L2Bytes)
	}
	if stats.L2Entries >= 20 {
		t.Errorf("L2Entries = %d, want < 20", stats.L2Entries)
	}
}

func TestCache_L3BoundedAtExactly2048Entries(t *testing.T) {
	c := NewCache(DefaultPageBudgetBytes, nil)
	const combos = 2500
	for i := 0; i < combos; i++ {
		filter := filterFor(i)
		c.StoreCount("conn", "database:kira_test/schema:app/table:order_items", &filter, 3, true)
	}
	if got := c.Stats().L3Entries; got != 2048 {
		t.Errorf("L3Entries = %d, want 2048", got)
	}
}

// InvalidateAfterMutation's asymmetry (§7, P43 F12/D17) is not exercised by the ported TypeScript
// unit spec (it is presumably covered indirectly by a higher-level tests/db/ mutate case), but it
// is one of the four behaviours P58a §4.7 explicitly flags as looking like a bug without its reason
// attached, so it gets its own direct Go coverage: a local mutation must drop the target's pages
// outright but only mark its counts stale, never drop them — DropTarget is the one that drops both.
func TestCache_InvalidateAfterMutation_DropsPagesButOnlyStalesCounts(t *testing.T) {
	const connID, path = "conn", "database:kira_test/schema:app/table:order_items"
	filter := "status = 'open'"

	c := NewCache(DefaultPageBudgetBytes, nil)
	req := ReadRequest{ConnectionID: connID, Path: path, Cursor: pageOffsetCursor(0)}
	key, label := PageCacheKey(req)
	c.StorePage(key, label, req, fakePage(10))
	c.StoreCount(connID, path, &filter, 42, true)

	c.InvalidateAfterMutation(connID, path)

	if _, ok := c.ReadPage(key); ok {
		t.Error("InvalidateAfterMutation must drop the target's pages")
	}
	entry, ok := c.Count(connID, path, &filter)
	if !ok {
		t.Fatal("InvalidateAfterMutation must not drop the target's counts")
	}
	if entry.Value != 42 || !entry.Stale {
		t.Errorf("Count() = %+v, want value=42 stale=true", entry)
	}
}

func filterFor(i int) string {
	return "(1=1) OR (0=" + itoa(i) + ")"
}

func pageOffsetCursor(offset int) model.PageCursor {
	return model.PageCursor{Mode: "offset", Offset: offset}
}
