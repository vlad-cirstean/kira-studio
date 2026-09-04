package repos_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// P11 §6.2: the four caps, each asserted on the boundary — mirrors response_history_test.go's own
// "cache eviction with interacting rules" posture (AGENTS.md), not CRUD round trips.

func newGrpcHistoryRepo(t *testing.T) *repos.GrpcHistoryRepo {
	t.Helper()
	return &repos.GrpcHistoryRepo{DB: newRepos(t).DB}
}

func grpcRec(itemID, tabID string, messages int) model.GrpcCallHistoryRecord {
	msgs := make([]model.GrpcCallSnapshotMessage, messages)
	for i := range msgs {
		msgs[i] = model.GrpcCallSnapshotMessage{Seq: i, JSON: `{"n":` + strconv.Itoa(i) + `}`, WireBytes: 10, OffsetMs: int64(i)}
	}
	return model.GrpcCallHistoryRecord{
		ItemID: itemID, TabID: tabID, Target: "api.example.com:443", Method: "kira.probe.v1.Echo/Unary",
		Streaming: model.GrpcStreamingUnary, Message: `{"text":"hi"}`,
		Code: 0, CodeName: "OK", ElapsedMs: 5, MessageCount: messages, MessageBytes: messages * 10,
		Messages: msgs,
	}
}

// ---- 1. The per-scope count cap: 25 recorded against one item_id leaves the 20 newest ----

func TestGrpcHistoryPerScopeCountCap(t *testing.T) {
	r := newGrpcHistoryRepo(t)
	cr := &repos.CollectionsRepo{DB: r.DB}
	c, err := cr.CreateCollection("Probes")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	item, err := cr.CreateGrpcItem(c.ID, nil, "Unary", nil)
	if err != nil {
		t.Fatalf("CreateGrpcItem: %v", err)
	}

	for i := 0; i < 25; i++ {
		if err := r.Record(grpcRec(item.ID, "tab1", 1)); err != nil {
			t.Fatalf("Record(%d): %v", i, err)
		}
	}

	entries, err := r.List(item.ID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 20 {
		t.Fatalf("List returned %d entries, want 20", len(entries))
	}
}

// ---- 2. Per-message truncation: a message over 64 KiB is stored truncated, flagged ----

func TestGrpcHistoryPerMessageTruncation(t *testing.T) {
	r := newGrpcHistoryRepo(t)

	bigJSON := `{"text":"` + strings.Repeat("x", 100*1024) + `"}`
	rec := model.GrpcCallHistoryRecord{
		TabID: "tab1", Target: "api.example.com:443", Method: "kira.probe.v1.Echo/Unary",
		Streaming: model.GrpcStreamingUnary, Message: `{}`,
		Code: 0, CodeName: "OK", ElapsedMs: 5, MessageCount: 1, MessageBytes: len(bigJSON),
		Messages: []model.GrpcCallSnapshotMessage{{Seq: 0, JSON: bigJSON, WireBytes: len(bigJSON)}},
	}
	if err := r.Record(rec); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := r.List("tab:tab1")
	if err != nil || len(entries) != 1 {
		t.Fatalf("List: %d entries, err %v", len(entries), err)
	}
	snap, err := r.Get(entries[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(snap.Messages) != 1 {
		t.Fatalf("Messages = %d, want 1", len(snap.Messages))
	}
	if !snap.Messages[0].Truncated {
		t.Error("Messages[0].Truncated = false, want true")
	}
	if len(snap.Messages[0].JSON) != 64*1024 {
		t.Errorf("stored message = %d bytes, want exactly the 64 KiB cap", len(snap.Messages[0].JSON))
	}
}

// ---- 3. The 100-message elision: a 250-message call stores the first 100, flags MessagesElided,
// and keeps the true MessageCount on the summary row ----

func TestGrpcHistoryMessageElision(t *testing.T) {
	r := newGrpcHistoryRepo(t)

	const total = 250
	rec := grpcRec("", "tab1", total)
	rec.MessageCount = total // the true count the call actually produced
	if err := r.Record(rec); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := r.List("tab:tab1")
	if err != nil || len(entries) != 1 {
		t.Fatalf("List: %d entries, err %v", len(entries), err)
	}
	if entries[0].MessageCount != total {
		t.Errorf("summary MessageCount = %d, want the true %d", entries[0].MessageCount, total)
	}

	snap, err := r.Get(entries[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(snap.Messages) != 100 {
		t.Fatalf("stored Messages = %d, want exactly the 100-message cap", len(snap.Messages))
	}
	if !snap.MessagesElided {
		t.Error("MessagesElided = false, want true")
	}
}

// ---- 4. The global byte budget evicts oldest-first across scopes ----

func TestGrpcHistoryGlobalByteBudgetEvictsOldestAcrossScopes(t *testing.T) {
	r := newGrpcHistoryRepo(t)

	pad := strings.Repeat("z", 4000)
	old := grpcRec("", "tab1", 1)
	old.Messages[0].JSON = `{"text":"old-` + pad + `"}`
	old.MessageBytes = len(old.Messages[0].JSON)
	// Recorded under the default (large) budget, so it is not itself swept on insert.
	if err := r.Record(old); err != nil {
		t.Fatalf("Record old: %v", err)
	}
	oldEntries, err := r.List("tab:tab1")
	if err != nil || len(oldEntries) != 1 {
		t.Fatalf("List(tab:tab1) = %d entries, err %v, want 1", len(oldEntries), err)
	}
	oneRowBudget := oldEntries[0].StoredBytes + 200

	// Tight enough for exactly one row this size — the sweep that runs on every subsequent Record
	// re-evaluates the WHOLE table against the current budget, so recording a second, newer row of
	// the same size must evict the first (oldest) one, in a genuinely different scope.
	repos.SetGrpcHistoryByteBudgetForTest(t, oneRowBudget)

	newer := grpcRec("", "tab2", 1)
	newer.Messages[0].JSON = `{"text":"new-` + pad + `"}`
	newer.MessageBytes = len(newer.Messages[0].JSON)
	if err := r.Record(newer); err != nil {
		t.Fatalf("Record newer: %v", err)
	}

	oldAfter, err := r.List("tab:tab1")
	if err != nil {
		t.Fatalf("List(tab:tab1) after sweep: %v", err)
	}
	if len(oldAfter) != 0 {
		t.Errorf("the oldest scope should have been swept once the newer row pushed the table over budget, found %d entries", len(oldAfter))
	}
	newEntries, err := r.List("tab:tab2")
	if err != nil || len(newEntries) != 1 {
		t.Fatalf("List(tab:tab2) = %d entries, err %v, want 1 (the newest must survive)", len(newEntries), err)
	}
}

// ---- Adopt and SweepOrphans ----

func TestGrpcHistoryAdopt(t *testing.T) {
	r := newGrpcHistoryRepo(t)
	cr := &repos.CollectionsRepo{DB: r.DB}
	c, err := cr.CreateCollection("Probes")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	item, err := cr.CreateGrpcItem(c.ID, nil, "Unary", nil)
	if err != nil {
		t.Fatalf("CreateGrpcItem: %v", err)
	}

	if err := r.Record(grpcRec("", "tab1", 1)); err != nil {
		t.Fatalf("Record: %v", err)
	}
	n, err := r.Adopt("tab1", item.ID)
	if err != nil {
		t.Fatalf("Adopt: %v", err)
	}
	if n != 1 {
		t.Fatalf("Adopt moved %d rows, want 1", n)
	}
	entries, err := r.List(item.ID)
	if err != nil || len(entries) != 1 {
		t.Fatalf("List(item.ID) after adopt = %d entries, err %v, want 1", len(entries), err)
	}
	scratch, err := r.List("tab:tab1")
	if err != nil || len(scratch) != 0 {
		t.Fatalf("List(tab:tab1) after adopt = %d entries, err %v, want 0", len(scratch), err)
	}
}

func TestGrpcHistorySweepOrphans(t *testing.T) {
	r := newGrpcHistoryRepo(t)

	if err := r.Record(grpcRec("", "live-tab", 1)); err != nil {
		t.Fatalf("Record live: %v", err)
	}
	if err := r.Record(grpcRec("", "closed-tab", 1)); err != nil {
		t.Fatalf("Record closed: %v", err)
	}
	seedLiveTab(t, r.DB, "live-tab")

	if err := r.SweepOrphans(); err != nil {
		t.Fatalf("SweepOrphans: %v", err)
	}

	live, err := r.List("tab:live-tab")
	if err != nil || len(live) != 1 {
		t.Fatalf("List(tab:live-tab) = %d entries, err %v, want 1 (a live tab's history survives)", len(live), err)
	}
	closed, err := r.List("tab:closed-tab")
	if err != nil || len(closed) != 0 {
		t.Fatalf("List(tab:closed-tab) = %d entries, err %v, want 0 (a closed tab's history is swept)", len(closed), err)
	}
}
