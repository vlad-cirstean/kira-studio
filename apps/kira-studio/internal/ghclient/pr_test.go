package ghclient

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func strPtr(s string) *string { return &s }

// TestDeriveState_FourOutcomes is exit criterion 4: merged/draft/open/closed, in exactly D4's own
// derivation order (merged_at wins over everything, including a state of "open").
func TestDeriveState_FourOutcomes(t *testing.T) {
	cases := []struct {
		name      string
		state     string
		draft     bool
		mergedAt  *string
		wantState string
	}{
		{"merged wins even over open+draft", "open", true, strPtr("2026-01-01T00:00:00Z"), "merged"},
		{"merged, closed state", "closed", false, strPtr("2026-01-01T00:00:00Z"), "merged"},
		{"open draft", "open", true, nil, "draft"},
		{"open non-draft", "open", false, nil, "open"},
		{"closed, no merge", "closed", false, nil, "closed"},
		{"empty merged_at string treated as unmerged", "open", false, strPtr(""), "open"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := deriveState(c.state, c.draft, c.mergedAt)
			if got != c.wantState {
				t.Fatalf("deriveState(%q, %v, %v) = %q, want %q", c.state, c.draft, c.mergedAt, got, c.wantState)
			}
		})
	}
}

// --- argv-golden tests: D4's three calls, byte-exact []string, --hostname included -------------

// recordingRunner is the Client's own api-call Runner in every test below — separate from the
// Discovery's own Runner (okRunner(), from discovery_test.go), exactly matching D1's Client shape
// (discovery + a second, distinct runner).
type recordingRunner struct {
	lastArgs []string
	result   Result
}

func (r *recordingRunner) Run(_ context.Context, _ string, spec Spec) (Result, error) {
	r.lastArgs = spec.Args
	return r.result, nil
}

func testClient(t *testing.T, runner *recordingRunner) *Client {
	t.Helper()
	discovery := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, okRunner(), &fakeClock{})
	return NewClient(discovery, runner)
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}

var testRepo = Repo{Host: "github.com", Owner: "o", Name: "r"}

func TestPullsForCommit_ArgvGolden(t *testing.T) {
	runner := &recordingRunner{result: Result{ExitCode: 0, Stdout: readFixture(t, "commit_pulls.json")}}
	c := testClient(t, runner)

	prs, status := c.PullsForCommit(context.Background(), testRepo, "abc123")
	if !status.OK() {
		t.Fatalf("status = %+v, want ok", status)
	}
	want := []string{
		"api", "--hostname", "github.com", "--method", "GET",
		"-H", "Accept: application/vnd.github+json",
		"-H", "X-GitHub-Api-Version: 2022-11-28",
		"repos/o/r/commits/abc123/pulls?per_page=10",
	}
	if !reflect.DeepEqual(runner.lastArgs, want) {
		t.Fatalf("argv = %#v, want %#v", runner.lastArgs, want)
	}
	if len(prs) != 1 || prs[0].Number != 123 || prs[0].State != "merged" || prs[0].HeadSha != "abc123" {
		t.Fatalf("prs = %+v, want one merged PR #123", prs)
	}
}

func TestPullsForBranch_ArgvGolden(t *testing.T) {
	runner := &recordingRunner{result: Result{ExitCode: 0, Stdout: readFixture(t, "branch_pulls.json")}}
	c := testClient(t, runner)

	prs, status := c.PullsForBranch(context.Background(), testRepo, "add-gizmo")
	if !status.OK() {
		t.Fatalf("status = %+v, want ok", status)
	}
	want := []string{
		"api", "--hostname", "github.com", "--method", "GET",
		"-H", "Accept: application/vnd.github+json",
		"-H", "X-GitHub-Api-Version: 2022-11-28",
		"repos/o/r/pulls?head=o:add-gizmo&state=all&sort=updated&direction=desc&per_page=5",
	}
	if !reflect.DeepEqual(runner.lastArgs, want) {
		t.Fatalf("argv = %#v, want %#v", runner.lastArgs, want)
	}
	if len(prs) != 1 || prs[0].Number != 456 || prs[0].State != "draft" {
		t.Fatalf("prs = %+v, want one draft PR #456", prs)
	}
}

func TestOpenPulls_ArgvGoldenAndEarlyStop(t *testing.T) {
	runner := &recordingRunner{result: Result{ExitCode: 0, Stdout: readFixture(t, "open_pulls_page1.json")}}
	c := testClient(t, runner)

	prs, status := c.OpenPulls(context.Background(), testRepo)
	if !status.OK() {
		t.Fatalf("status = %+v, want ok", status)
	}
	want := []string{
		"api", "--hostname", "github.com", "--method", "GET",
		"-H", "Accept: application/vnd.github+json",
		"-H", "X-GitHub-Api-Version: 2022-11-28",
		"repos/o/r/pulls?state=open&sort=updated&direction=desc&per_page=100&page=1",
	}
	if !reflect.DeepEqual(runner.lastArgs, want) {
		t.Fatalf("argv (last call) = %#v, want %#v", runner.lastArgs, want)
	}
	// The fixture returns one element, well under per_page=100 — OpenPulls must stop after page 1
	// rather than requesting page 2.
	if len(prs) != 1 || prs[0].Number != 1 {
		t.Fatalf("prs = %+v, want exactly the one open PR from page 1", prs)
	}
}

// TestOpenPulls_StopsAtMaxSnapshotPages proves the 3-page cap fires even when every page comes
// back full (100 elements) — a runner that always returns exactly per_page rows would otherwise
// paginate forever.
func TestOpenPulls_StopsAtMaxSnapshotPages(t *testing.T) {
	full := make([]byte, 0)
	{
		// A 100-element array — content does not matter, only its length (>= per_page).
		buf := []byte("[")
		for i := 0; i < 100; i++ {
			if i > 0 {
				buf = append(buf, ',')
			}
			buf = append(buf, []byte(`{"number":1,"title":"x","html_url":"u","state":"open","draft":false,"merged_at":null,"head":{"ref":"r","sha":"s"},"base":{"ref":"main"},"updated_at":"2026-01-01T00:00:00Z"}`)...)
		}
		buf = append(buf, ']')
		full = buf
	}
	callCount := 0
	runner := &countingArgvRunner{result: Result{ExitCode: 0, Stdout: full}, onCall: func() { callCount++ }}
	discovery := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, okRunner(), &fakeClock{})
	c := NewClient(discovery, runner)

	prs, status := c.OpenPulls(context.Background(), testRepo)
	if !status.OK() {
		t.Fatalf("status = %+v, want ok", status)
	}
	if callCount != maxSnapshotPages {
		t.Fatalf("callCount = %d, want exactly maxSnapshotPages (%d)", callCount, maxSnapshotPages)
	}
	if len(prs) != 100*maxSnapshotPages {
		t.Fatalf("len(prs) = %d, want %d", len(prs), 100*maxSnapshotPages)
	}
}

type countingArgvRunner struct {
	result Result
	onCall func()
}

func (r *countingArgvRunner) Run(_ context.Context, _ string, _ Spec) (Result, error) {
	r.onCall()
	return r.result, nil
}
