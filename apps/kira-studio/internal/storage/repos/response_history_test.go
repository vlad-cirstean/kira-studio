package repos_test

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// P8 §6.2: seven cases, each guarding a rule genuinely easy to get wrong when three caps and a
// generated scope column interact (Record is "cache eviction with interacting rules",
// AGENTS.md's own named category) — not CRUD round trips. Explicitly not tested here: that List
// returns what Record inserted, that Delete deletes, that Get decodes a snapshot it just wrote,
// that a missing tabId is refused — each a CRUD round trip or a one-condition guard.

func newResponseHistoryRepo(t *testing.T) (*repos.ResponseHistoryRepo, *sql.DB) {
	t.Helper()
	db := newRepos(t).DB
	return &repos.ResponseHistoryRepo{DB: db}, db
}

func newItemFor(t *testing.T, db *sql.DB) string {
	t.Helper()
	cr := &repos.CollectionsRepo{DB: db}
	c, err := cr.CreateCollection("Orders")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	item, err := cr.CreateItem(c.ID, nil, model.CollectionItemRequest, "Get order", &model.SavedRequest{
		Method: "GET", BodyMode: "none", CodeLanguage: "json",
	})
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}
	return item.ID
}

func seedLiveTab(t *testing.T, db *sql.DB, tabID string) {
	t.Helper()
	if err := (&repos.WindowsRepo{DB: db}).EnsureExists("win1"); err != nil {
		t.Fatalf("EnsureExists(win1): %v", err)
	}
	tr := &repos.TabsRepo{DB: db}
	if err := tr.Save("win1", []model.TabRecord{
		{ID: tabID, Path: "request", Kind: "http-request", State: json.RawMessage(`{}`)},
	}); err != nil {
		t.Fatalf("seedLiveTab(%s): %v", tabID, err)
	}
}

func rec(itemID, tabID string, status int, body string) model.ResponseHistoryRecord {
	return model.ResponseHistoryRecord{
		ItemID:  itemID,
		TabID:   tabID,
		Method:  "GET",
		URL:     "https://api.example.com/orders",
		Headers: []httpclient.Header{{Name: "Accept", Value: "application/json"}},
		Body:    httpclient.Body{Mode: "none"},
		Response: httpclient.Response{
			Status: status, StatusText: "OK", Proto: "HTTP/1.1",
			Headers: []httpclient.Header{{Name: "Content-Type", Value: "application/json"}},
			Body:    body, BodyEncoding: "utf8", BodyBytes: len(body), ElapsedMs: 12,
		},
	}
}

// ---- 1. The per-scope count cap: 25 recorded against one item_id leaves the 20 newest ----

func TestResponseHistoryPerScopeCountCap(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	itemID := newItemFor(t, db)

	for i := 0; i < 25; i++ {
		if err := r.Record(rec(itemID, "tab1", 200, "body")); err != nil {
			t.Fatalf("Record(%d): %v", i, err)
		}
	}

	entries, err := r.List(itemID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 20 {
		t.Fatalf("List returned %d entries, want 20", len(entries))
	}
}

// ---- 2. Scope separation: item_id=i1, item_id=i2 and a scratch tab_id are three independent caps ----

func TestResponseHistoryScopeSeparation(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	item1 := newItemFor(t, db)
	item2 := newItemFor(t, db)

	for i := 0; i < 3; i++ {
		if err := r.Record(rec(item1, "tab1", 200, "a")); err != nil {
			t.Fatalf("Record item1(%d): %v", i, err)
		}
	}
	for i := 0; i < 5; i++ {
		if err := r.Record(rec(item2, "tab2", 200, "b")); err != nil {
			t.Fatalf("Record item2(%d): %v", i, err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := r.Record(rec("", "tab3", 200, "c")); err != nil {
			t.Fatalf("Record scratch(%d): %v", i, err)
		}
	}

	e1, err := r.List(item1)
	if err != nil || len(e1) != 3 {
		t.Fatalf("List(item1) = %d entries, err %v, want 3", len(e1), err)
	}
	e2, err := r.List(item2)
	if err != nil || len(e2) != 5 {
		t.Fatalf("List(item2) = %d entries, err %v, want 5", len(e2), err)
	}
	e3, err := r.List("tab:tab3")
	if err != nil || len(e3) != 2 {
		t.Fatalf("List(tab:tab3) = %d entries, err %v, want 2", len(e3), err)
	}
}

// ---- 3. The per-entry storage cap: a 1 MiB body is stored at 256 KiB, truncated ----

func TestResponseHistoryPerEntryStorageCap(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	itemID := newItemFor(t, db)

	bigBody := strings.Repeat("x", 1024*1024)
	entry := rec(itemID, "tab1", 200, bigBody)
	if err := r.Record(entry); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := r.List(itemID)
	if err != nil || len(entries) != 1 {
		t.Fatalf("List: %d entries, err %v", len(entries), err)
	}
	if entries[0].BodyBytes != len(bigBody) {
		t.Fatalf("BodyBytes = %d, want %d (the transfer size, untouched)", entries[0].BodyBytes, len(bigBody))
	}
	if entries[0].StoredBytes >= len(bigBody) {
		t.Fatalf("StoredBytes = %d, want well under the 1 MiB body", entries[0].StoredBytes)
	}

	snap, err := r.Get(entries[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !snap.BodyStorageTruncated {
		t.Fatal("BodyStorageTruncated = false, want true")
	}
	if !snap.BodyStored {
		t.Fatal("BodyStored = false, want true (truncated is still stored)")
	}
	if len(snap.Response.Body) != 256*1024 {
		t.Fatalf("stored body = %d bytes, want exactly the 256 KiB cap", len(snap.Response.Body))
	}
}

// ---- 4. A binary body: no bytes stored, bodyBytes intact ----

func TestResponseHistoryBinaryBodyNotStored(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	itemID := newItemFor(t, db)

	entry := rec(itemID, "tab1", 200, "aGVsbG8=")
	entry.Response.BodyEncoding = "base64"
	entry.Response.BodyBytes = 412 * 1024
	if err := r.Record(entry); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := r.List(itemID)
	if err != nil || len(entries) != 1 {
		t.Fatalf("List: %d entries, err %v", len(entries), err)
	}
	if entries[0].BodyBytes != 412*1024 {
		t.Fatalf("BodyBytes = %d, want 412*1024 (untouched)", entries[0].BodyBytes)
	}
	if entries[0].StoredBytes >= entries[0].BodyBytes {
		t.Fatalf("StoredBytes = %d, want small (no body kept)", entries[0].StoredBytes)
	}

	snap, err := r.Get(entries[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if snap.BodyStored {
		t.Fatal("BodyStored = true, want false for a binary body")
	}
	if snap.Response.Body != "" {
		t.Fatalf("Response.Body = %q, want empty", snap.Response.Body)
	}
}

// ---- 5. The global byte budget evicts oldest-first across scopes, not just within one ----

func TestResponseHistoryGlobalByteBudgetEvictsOldestAcrossScopes(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	item1 := newItemFor(t, db)
	item2 := newItemFor(t, db)

	// Four rows, two per scope, oldest-to-newest by insertion (rowid) order. old-A/old-B (the two
	// absolute oldest, one per scope) carry a deliberately padded body so they are unmistakably
	// the biggest rows in the table — a wide, robust margin rather than one relying on two rows
	// happening to be nearly the same size. mid-A/mid-B are ordinary small bodies.
	oldPad := strings.Repeat("z", 1000)
	if err := r.Record(rec(item1, "tab1", 200, "old-A-"+oldPad)); err != nil {
		t.Fatalf("Record old-A: %v", err)
	}
	if err := r.Record(rec(item2, "tab2", 200, "old-B-"+oldPad)); err != nil {
		t.Fatalf("Record old-B: %v", err)
	}
	if err := r.Record(rec(item1, "tab1", 200, "mid-A")); err != nil {
		t.Fatalf("Record mid-A: %v", err)
	}
	if err := r.Record(rec(item2, "tab2", 200, "mid-B")); err != nil {
		t.Fatalf("Record mid-B: %v", err)
	}

	var midBytes int
	if err := db.QueryRow(
		`SELECT COALESCE(SUM(stored_bytes), 0) FROM http_response_history WHERE snapshot_json LIKE '%"mid-%'`,
	).Scan(&midBytes); err != nil {
		t.Fatalf("sum mid-*/stored_bytes: %v", err)
	}

	// Shrink the real budget to "both mid-* rows, plus generous headroom for one more small row"
	// — comfortably more than the "newest" row inserted below (an ordinary small body, the same
	// size class as mid-A/mid-B) needs, and comfortably less than either padded old-* row costs on
	// its own, so the boundary is robust to encoding noise rather than balanced on it (§6.2's
	// "shrink the budget for the test").
	repos.SetHistoryByteBudgetForTest(t, midBytes+600)

	if err := r.Record(rec(item1, "tab1", 200, "newest")); err != nil {
		t.Fatalf("Record newest: %v", err)
	}

	// The property a per-scope cap alone cannot give (D6): item2 never had more than two entries
	// (well under its own 20-row cap), yet it lost one to the *global* sweep because the two
	// oldest rows in the whole table happened to belong to two different scopes.
	e1, err := r.List(item1)
	if err != nil {
		t.Fatalf("List(item1): %v", err)
	}
	e2, err := r.List(item2)
	if err != nil {
		t.Fatalf("List(item2): %v", err)
	}
	if len(e1) != 2 {
		t.Fatalf("List(item1) = %d entries, want 2 (mid-A, newest)", len(e1))
	}
	if len(e2) != 1 {
		t.Fatalf("List(item2) = %d entries, want 1 (mid-B only — old-B evicted by the global sweep)", len(e2))
	}

	var survivingOld int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM http_response_history WHERE snapshot_json LIKE '%"old-%'`,
	).Scan(&survivingOld); err != nil {
		t.Fatalf("count old-* survivors: %v", err)
	}
	if survivingOld != 0 {
		t.Fatalf("%d of the two oldest rows survived the budget sweep, want 0", survivingOld)
	}

	var newestSurvived int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM http_response_history WHERE snapshot_json LIKE '%"newest"%'`,
	).Scan(&newestSurvived); err != nil {
		t.Fatalf("count newest: %v", err)
	}
	if newestSurvived != 1 {
		t.Fatal("the just-inserted row was itself evicted — the per-entry cap invariant (D6) is broken")
	}
}

// ---- 6. Cascade and sweep ----

func TestResponseHistoryCascadeAndSweepOrphans(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	cr := &repos.CollectionsRepo{DB: db}
	c, err := cr.CreateCollection("Orders")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	item, err := cr.CreateItem(c.ID, nil, model.CollectionItemRequest, "Get order", &model.SavedRequest{
		Method: "GET", BodyMode: "none", CodeLanguage: "json",
	})
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}

	seedLiveTab(t, db, "live-tab")
	// "closed-tab" is deliberately never seeded into `tabs` — SweepOrphans' liveness oracle.

	if err := r.Record(rec(item.ID, "tab-for-item", 200, "kept-by-cascade-test")); err != nil {
		t.Fatalf("Record item-scoped: %v", err)
	}
	if err := r.Record(rec("", "live-tab", 200, "live")); err != nil {
		t.Fatalf("Record live tab: %v", err)
	}
	if err := r.Record(rec("", "closed-tab", 200, "closed")); err != nil {
		t.Fatalf("Record closed tab: %v", err)
	}

	// F5: deleting the item cascades its history away.
	if err := cr.Delete(item.ID, "item"); err != nil {
		t.Fatalf("Delete item: %v", err)
	}
	if entries, err := r.List(item.ID); err != nil || len(entries) != 0 {
		t.Fatalf("List(item.ID) after delete = %d entries, err %v, want 0", len(entries), err)
	}

	// F4/D7: SweepOrphans removes the closed tab's history and leaves the live tab's alone.
	if err := r.SweepOrphans(); err != nil {
		t.Fatalf("SweepOrphans: %v", err)
	}
	if entries, err := r.List("tab:closed-tab"); err != nil || len(entries) != 0 {
		t.Fatalf("List(tab:closed-tab) after sweep = %d entries, err %v, want 0", len(entries), err)
	}
	if entries, err := r.List("tab:live-tab"); err != nil || len(entries) != 1 {
		t.Fatalf("List(tab:live-tab) after sweep = %d entries, err %v, want 1 (untouched)", len(entries), err)
	}
}

// ---- 7. Adopt: a scratch tab's entries move to an item with one UPDATE ----

func TestResponseHistoryAdopt(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	itemID := newItemFor(t, db)

	for i := 0; i < 3; i++ {
		if err := r.Record(rec("", "scratch-tab", 200, "iterating")); err != nil {
			t.Fatalf("Record(%d): %v", i, err)
		}
	}
	if entries, err := r.List("tab:scratch-tab"); err != nil || len(entries) != 3 {
		t.Fatalf("List(tab:scratch-tab) before adopt = %d entries, err %v, want 3", len(entries), err)
	}

	n, err := r.Adopt("scratch-tab", itemID)
	if err != nil {
		t.Fatalf("Adopt: %v", err)
	}
	if n != 3 {
		t.Fatalf("Adopt returned %d, want 3", n)
	}

	if entries, err := r.List(itemID); err != nil || len(entries) != 3 {
		t.Fatalf("List(itemID) after adopt = %d entries, err %v, want 3", len(entries), err)
	}
	if entries, err := r.List("tab:scratch-tab"); err != nil || len(entries) != 0 {
		t.Fatalf("List(tab:scratch-tab) after adopt = %d entries, err %v, want 0", len(entries), err)
	}
}

// ---- 8. P9 D7/F12: a rendered exchange never reaches kira.sqlite ----
//
// A security assertion, not a CRUD round trip: it is the test that would catch a future refactor
// reintroducing the field. A non-nil Wire on the Response Record is given comes back nil after a
// Get, and the raw snapshot_json column contains no "wire" key at all — Wire's own
// json:"wire,omitempty" tag means a stripped pointer omits the key entirely, not just nulls it.

func TestResponseHistoryRecordStripsWireBeforePersisting(t *testing.T) {
	r, db := newResponseHistoryRepo(t)
	itemID := newItemFor(t, db)

	withWire := rec(itemID, "tab1", 200, "body")
	withWire.Response.Wire = &httpclient.WireExchange{
		Request:      "GET /orders HTTP/1.1\r\nAuthorization: Bearer super-secret-token\r\n\r\n",
		ResponseHead: "HTTP/1.1 200 OK\r\n\r\n",
		Fidelity:     "exact",
	}
	if err := r.Record(withWire); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := r.List(itemID)
	if err != nil || len(entries) != 1 {
		t.Fatalf("List = %d entries, err %v, want 1", len(entries), err)
	}
	id := entries[0].ID

	var rawSnapshot string
	if err := db.QueryRow(`SELECT snapshot_json FROM http_response_history WHERE id = ?`, id).Scan(&rawSnapshot); err != nil {
		t.Fatalf("query snapshot_json: %v", err)
	}
	if strings.Contains(rawSnapshot, "wire") {
		t.Fatalf("stored snapshot_json contains a \"wire\" key — a secret would leak into kira.sqlite:\n%s", rawSnapshot)
	}
	if strings.Contains(rawSnapshot, "super-secret-token") {
		t.Fatal("stored snapshot_json contains the rendered exchange's credential")
	}

	snap, err := r.Get(id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if snap.Response.Wire != nil {
		t.Fatalf("decoded Response.Wire = %+v, want nil", snap.Response.Wire)
	}
}
