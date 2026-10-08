//go:build claudesmoke

package memory

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// Real Claude Code CLI, not in CI: go test -tags claudesmoke ./internal/memory/ -run Smoke -v
func TestSmokeRealClaude(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "memory.db"))
	defer store.Close()
	svc := NewService(store, NewCLIRunner(), ServiceOptions{})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	do := func(r StoreRequest) StoreResult {
		t.Helper()
		r.Author, r.Source = AuthorUser, SourceUI
		res, err := svc.Store(ctx, r)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%+v", res)
		return res
	}

	if res := do(StoreRequest{Items: []Item{{Fact: "it uses port 8080", Reason: "because"}}}); res.Status != "challenged" {
		t.Errorf("ambiguous item: status = %s, want challenged", res.Status)
	}
	res := do(StoreRequest{Items: []Item{{
		Fact:   "The billing-api service listens on port 8080 in production.",
		Reason: "Stated in the billing-api deployment manifest.",
	}}})
	if res.Status != "stored" || len(res.Outcomes) != 1 || res.Outcomes[0].Action != ActionAdd {
		t.Fatalf("clear item: %+v", res)
	}
	res = do(StoreRequest{Items: []Item{{
		Fact:   "The billing-api service now listens on port 9090 in production, not 8080.",
		Reason: "The manifest changed in the March release.",
	}}})
	if res.Status != "stored" || len(res.Outcomes) != 1 || res.Outcomes[0].Action != ActionUpdate {
		t.Fatalf("refining item: %+v", res)
	}
	all, err := svc.Search(ctx, SearchArgs{Query: "billing port", IncludeHistory: true})
	if err != nil || len(all) != 2 {
		t.Fatalf("history search: %v %v", facts(all), err)
	}
}
