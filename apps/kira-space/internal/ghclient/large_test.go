package ghclient

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestOpenPulls_LargePage drives the real execRunner with a fake gh that prints a page over the old
// 4 MiB cap, so the pipe and bounded-writer path runs for real.
func TestOpenPulls_LargePage(t *testing.T) {
	pulls := make([]map[string]any, 100)
	body := strings.Repeat("x", 48<<10)
	for i := range pulls {
		pulls[i] = map[string]any{
			"number": i + 1, "title": "t", "html_url": "u", "state": "open",
			"head": map[string]any{"ref": "r", "sha": "s"}, "base": map[string]any{"ref": "main"},
			"body": body,
		}
	}
	data, err := json.Marshal(pulls)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) <= 4<<20 {
		t.Fatalf("fixture is %d bytes, want over 4 MiB", len(data))
	}
	fixture := filepath.Join(t.TempDir(), "page.json")
	if err := os.WriteFile(fixture, data, 0o600); err != nil {
		t.Fatal(err)
	}
	script := writeScript(t, "#!/bin/sh\ncat '"+fixture+"'\n")
	newClient := func() *Client {
		d := NewDiscovery(fakeLocator{found: true, path: script}, okRunner(), &fakeClock{})
		return NewClient(d, NewExecRunner())
	}

	t.Run("default cap decodes", func(t *testing.T) {
		c := newClient()
		prs, status := c.OpenPulls(context.Background(), testRepo)
		if !status.OK() || len(prs) != 300 {
			t.Fatalf("OpenPulls = %d PRs, status %+v; want 300, ok", len(prs), status)
		}
		prs, status = c.PullsForCommit(context.Background(), testRepo, "abc")
		if !status.OK() || len(prs) != 100 {
			t.Fatalf("PullsForCommit = %d PRs, status %+v; want 100, ok", len(prs), status)
		}
	})

	t.Run("lowered cap reports too large", func(t *testing.T) {
		old := maxStdoutBytes
		maxStdoutBytes = 1 << 20
		t.Cleanup(func() { maxStdoutBytes = old })
		_, status := newClient().OpenPulls(context.Background(), testRepo)
		if status.Kind != KindForbidden || status.Reason != tooLargeReason() || status.Reason == reasonUnreadable {
			t.Fatalf("status = %+v, want forbidden %q", status, tooLargeReason())
		}
	})
}
