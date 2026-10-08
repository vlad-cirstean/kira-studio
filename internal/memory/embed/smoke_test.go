//go:build embedsmoke

package embed

import (
	"context"
	"os"
	"os/exec"
	"testing"
)

// Real-model check, not in CI: needs KIRA_ORT_LIB and network. Run with
// KIRA_ORT_LIB=... go test -tags embedsmoke ./internal/memory/embed/ -run Smoke -v

func init() {
	if dir := os.Getenv("KIRA_EMBED_SMOKE_WORKER"); dir != "" {
		os.Exit(RunWorker([]string{"--model-dir", dir}))
	}
}

var smokeFacts = []string{
	"The user prefers tabs over spaces for indentation",
	"Production runs PostgreSQL 16 on a managed cluster",
	"Releases ship on Friday afternoons after the freeze",
	"The user is allergic to peanuts",
	"The team standup is at 9:30 every weekday morning",
	"API tokens rotate every ninety days",
	"The staging environment is reset every Sunday night",
	"The user prefers email over phone calls for communication",
	"Code reviews need two approvals before merging",
	"The laptop is a MacBook Pro with 32 GB of memory",
}

var smokeQueries = []string{
	"what whitespace style does the user like in source files",
	"which relational database serves live traffic",
	"when do new versions go out to customers",
	"does the user have any food restrictions",
	"what time does the daily sync meeting start",
	"how often are credentials renewed",
	"when does the test environment get wiped",
	"how should I get in touch with the user",
	"how many reviewers must sign off on a pull request",
	"what hardware does the user work on",
}

func TestSmokeRealModel(t *testing.T) {
	if os.Getenv("KIRA_ORT_LIB") == "" {
		t.Skip("KIRA_ORT_LIB not set")
	}
	home := t.TempDir()
	dir := ModelDir(home, Default)
	var last int64
	if err := Install(context.Background(), dir, Default, func(done, total int64) { last = done }); err != nil {
		t.Fatal(err)
	}
	if last != Default.TotalSize() || !Installed(dir, Default) {
		t.Fatalf("install incomplete: %d of %d bytes", last, Default.TotalSize())
	}
	c := NewClient(ClientOptions{Spec: Default, Home: home, Command: func(d string) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^$")
		cmd.Env = append(os.Environ(), "KIRA_EMBED_SMOKE_WORKER="+d)
		return cmd
	}})
	defer c.Close()

	docs, err := c.Embed(context.Background(), smokeFacts, false)
	if err != nil {
		t.Fatal(err)
	}
	qs, err := c.Embed(context.Background(), smokeQueries, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range append(docs, qs...) {
		if len(v) != Default.Dim {
			t.Fatalf("dim = %d, want %d", len(v), Default.Dim)
		}
		if n := Dot(v, v); n < 0.999 || n > 1.001 {
			t.Fatalf("norm^2 = %v, want 1", n)
		}
	}
	hits := 0
	for i, q := range qs {
		best, bestScore := -1, float32(-2)
		for j, d := range docs {
			if s := Dot(q, d); s > bestScore {
				best, bestScore = j, s
			}
		}
		if best == i {
			hits++
		} else {
			t.Logf("miss: %q -> %q", smokeQueries[i], smokeFacts[best])
		}
	}
	t.Logf("top-1 %d/%d", hits, len(qs))
	if hits < 8 {
		t.Errorf("top-1 = %d/10, want at least 8", hits)
	}
}
