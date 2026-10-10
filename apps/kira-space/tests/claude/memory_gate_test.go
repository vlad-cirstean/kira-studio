package claude

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory"
)

func memoryFacts(ms []memory.Memory) []string {
	out := []string{}
	for _, m := range ms {
		out = append(out, m.Fact)
	}
	return out
}

func TestMemoryGate(t *testing.T) {
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("real claude tests: no claude on PATH")
	}
	store := memory.NewStore(filepath.Join(t.TempDir(), "memory.db"))
	defer store.Close()
	svc := memory.NewService(store, memory.NewCLIRunner(), memory.ServiceOptions{})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	do := func(r memory.StoreRequest) memory.StoreResult {
		t.Helper()
		r.Author, r.Source = memory.AuthorUser, memory.SourceUI
		res, err := svc.Store(ctx, r)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%+v", res)
		return res
	}

	if res := do(memory.StoreRequest{Items: []memory.Item{{Fact: "it uses port 8080", Reason: "because"}}}); res.Status != "challenged" {
		t.Errorf("ambiguous item: status = %s, want challenged", res.Status)
	}
	res := do(memory.StoreRequest{Items: []memory.Item{{
		Fact:   "The billing-api service listens on port 8080 in production.",
		Reason: "Stated in the billing-api deployment manifest.",
	}}})
	if res.Status != "stored" || len(res.Outcomes) != 1 || res.Outcomes[0].Action != memory.ActionAdd {
		t.Fatalf("clear item: %+v", res)
	}
	res = do(memory.StoreRequest{Items: []memory.Item{{
		Fact:   "The billing-api service now listens on port 9090 in production, not 8080.",
		Reason: "The manifest changed in the March release.",
	}}})
	if res.Status != "stored" || len(res.Outcomes) != 1 || res.Outcomes[0].Action != memory.ActionUpdate {
		t.Fatalf("refining item: %+v", res)
	}
	all, err := svc.Search(ctx, memory.SearchArgs{Query: "billing port", IncludeHistory: true})
	if err != nil || len(all) != 2 {
		t.Fatalf("history search: %v %v", memoryFacts(all), err)
	}
}
