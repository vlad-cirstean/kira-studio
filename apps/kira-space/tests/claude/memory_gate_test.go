package claude

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

func memoryFacts(ms []memory.Memory) []string {
	out := []string{}
	for _, m := range ms {
		out = append(out, m.Fact)
	}
	return out
}

func item(fact, reason string) memory.Item {
	return memory.Item{Fact: fact, Reason: reason, Origin: memory.OriginUser, Scope: memory.ScopePersonal}
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
		r.Source = memory.SourceUI
		res, err := svc.Store(ctx, r)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%+v", res)
		return res
	}

	if res := do(memory.StoreRequest{Items: []memory.Item{item("it uses port 8080", "because")}}); res.Status != "challenged" {
		t.Errorf("ambiguous item: status = %s, want challenged", res.Status)
	}
	res := do(memory.StoreRequest{Items: []memory.Item{item(
		"The billing-api service listens on port 8080 in production.",
		"Stated in the billing-api deployment manifest.",
	)}})
	if res.Status != "stored" || len(res.Outcomes) != 1 || res.Outcomes[0].Action != memory.ActionAdd {
		t.Fatalf("clear item: %+v", res)
	}
	res = do(memory.StoreRequest{Items: []memory.Item{item(
		"The billing-api service now listens on port 9090 in production, not 8080.",
		"The manifest changed in the March release.",
	)}})
	if res.Status != "stored" || len(res.Outcomes) != 1 || res.Outcomes[0].Action != memory.ActionUpdate {
		t.Fatalf("refining item: %+v", res)
	}
	all, err := svc.Search(ctx, memory.SearchArgs{Query: "billing port", IncludeHistory: true})
	if err != nil || len(all) != 2 {
		t.Fatalf("history search: %v %v", memoryFacts(all), err)
	}

	assertGateRewritesWordyItem(ctx, t)
}

// assertGateRewritesWordyItem checks the gate's style rule on a fresh store: filler goes, the number
// and the name stay, and the stored text passes the comment format's text rules.
func assertGateRewritesWordyItem(ctx context.Context, t *testing.T) {
	t.Helper()
	store := memory.NewStore(filepath.Join(t.TempDir(), "memory.db"))
	defer store.Close()
	svc := memory.NewService(store, memory.NewCLIRunner(), memory.ServiceOptions{})
	res, err := svc.Store(ctx, memory.StoreRequest{Source: memory.SourceUI, Items: []memory.Item{item(
		"Basically, the billing-api service is actually really listening on port 8080 in production, I think, because the manifest says so.",
		"Honestly, I just looked at the deployment manifest and it simply says so.",
	)}})
	if err != nil || res.Status != "stored" {
		t.Fatalf("wordy item: %+v, %v, want stored", res, err)
	}
	recent, err := svc.Recent(ctx, 10)
	if err != nil || len(recent) == 0 {
		t.Fatalf("Recent = %+v, %v", recent, err)
	}
	for _, m := range recent {
		t.Logf("wordy fact: %q reason: %q", m.Fact, m.Reason)
		low := strings.ToLower(m.Fact)
		if !strings.Contains(m.Fact, "8080") || !strings.Contains(low, "billing-api") {
			t.Errorf("fact %q lost the port or the service name", m.Fact)
		}
		for _, w := range []string{"basically", "actually", "really"} {
			if strings.Contains(low, w) {
				t.Errorf("fact %q keeps filler %q", m.Fact, w)
			}
		}
		if strings.Contains(m.Fact, "**") || strings.Contains(m.Fact, "`") || len(strings.Fields(m.Fact)) > 25 {
			t.Errorf("fact %q has markup or exceeds 25 words", m.Fact)
		}
		if msg := memfmt.CheckText(m.Fact); msg != "" {
			t.Errorf("fact %q: %s", m.Fact, msg)
		}
		if msg := memfmt.CheckText(m.Reason); msg != "" {
			t.Errorf("reason %q: %s", m.Reason, msg)
		}
	}
}
