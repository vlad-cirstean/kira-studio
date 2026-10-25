package github

import (
	"os"
	"path/filepath"
	"testing"
)

func probeFixture(t *testing.T, name string, exit int) Result {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return Result{Stdout: b, ExitCode: exit}
}

// gh exits 1 on a 304, so the status line must decide, never the exit code.
func TestParseProbe(t *testing.T) {
	t.Run("304 is unchanged and keeps the sent validator", func(t *testing.T) {
		changed, etag, s := parseProbe("github.com", probeFixture(t, "probe_304.txt", 1), `W/"old"`)
		if changed || !s.OK() || etag != `W/"old"` {
			t.Fatalf("changed=%v etag=%q status=%+v", changed, etag, s)
		}
	})
	t.Run("200 reports a change and the new ETag", func(t *testing.T) {
		changed, etag, s := parseProbe("github.com", probeFixture(t, "probe_200.txt", 0), "")
		if !changed || !s.OK() || etag != `W/"9b2e77"` {
			t.Fatalf("changed=%v etag=%q status=%+v", changed, etag, s)
		}
	})
	t.Run("403 with an empty budget is rate limited with its reset", func(t *testing.T) {
		_, _, s := parseProbe("github.com", probeFixture(t, "probe_403.txt", 1), "")
		if !isRateLimited(s) || s.ResetAt.Unix() != 1793008800 {
			t.Fatalf("status=%+v", s)
		}
	})
	t.Run("no header block falls back to the exit classification", func(t *testing.T) {
		_, _, s := parseProbe("github.com", Result{ExitCode: 1, Stderr: []byte("gh: Bad credentials (HTTP 401)")}, "")
		if s.Kind != KindUnauthenticated {
			t.Fatalf("status=%+v", s)
		}
	})
}
