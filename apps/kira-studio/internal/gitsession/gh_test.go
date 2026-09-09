package gitsession

import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
)

// githubRemoteRunner wraps identifyRunner (registry_test.go, same package) so a fake-git repo also
// answers `git remote get-url origin` — the ONE git spawn G24 D15 ever needs — with a stubbed
// GitHub URL, with no filesystem and no real git.sock behind it.
type githubRemoteRunner struct{ url string }

func (r githubRemoteRunner) Start(ctx context.Context, path string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) >= 2 && spec.Args[0] == "remote" && spec.Args[1] == "get-url" {
		return &fakeProcess{stdout: []byte(r.url + "\n")}, nil
	}
	return identifyRunner{}.Start(ctx, path, spec)
}

// fakeGhLocator/fakeGhRunner/fakeGhClock are this file's own minimal stand-ins for ghclient's own
// Locator/Runner/Clock (F13: no real `gh` anywhere) — deliberately small rather than importing
// ghclient's own unexported test fakes across the package boundary.
type fakeGhLocator struct{}

func (fakeGhLocator) Locate() (string, []string, bool) {
	return "/usr/local/bin/gh", []string{"/usr/local/bin/gh"}, true
}

// countingGhRunner answers `--version`/`auth status` as always-ok (so Discovery.Status is always
// "ok"), and every `api` call with whatever apiResult is currently set to — swappable mid-test so a
// scenario can flip from a normal response to a rate-limited one. calls counts every invocation
// of ANY kind, exactly what D13's own zero-spawn assertion (gitrpc, next step) needs; this file
// only needs the "was the api call actually skipped" half of that same counter.
type countingGhRunner struct {
	calls     int32
	apiResult ghclient.Result
}

func (r *countingGhRunner) Run(_ context.Context, _ string, spec ghclient.Spec) (ghclient.Result, error) {
	atomic.AddInt32(&r.calls, 1)
	if len(spec.Args) > 0 && spec.Args[0] == "api" {
		return r.apiResult, nil
	}
	return ghclient.Result{ExitCode: 0, Stdout: []byte("gh version 2.42.0 (2024-01-08)\n")}, nil
}

func (r *countingGhRunner) count() int { return int(atomic.LoadInt32(&r.calls)) }

func openPullsJSON() []byte {
	return []byte(`[]`)
}

func onePullJSON(number int, state string, draft bool, headRef string) []byte {
	merged := "null"
	if state == "merged" {
		merged = `"2026-01-01T00:00:00Z"`
		state = "closed"
	}
	return []byte(`[{"number":` + strconv.Itoa(number) + `,"title":"t","html_url":"u","state":"` + state +
		`","draft":` + strconv.FormatBool(draft) + `,"merged_at":` + merged +
		`,"head":{"ref":"` + headRef + `","sha":"s"},"base":{"ref":"main"},"updated_at":"2026-01-01T00:00:00Z"}]`)
}

// ghTestFixture wires a Registry with a fake identify+remote runner, a fake watcher, a real
// gitreview.Store under t.TempDir(), and a countingGhRunner-backed ghclient.Client.
type ghTestFixture struct {
	reg      *Registry
	entry    *RepoEntry
	release  func()
	watcher  *fakeWatcher
	ghRunner *countingGhRunner
	review   *gitreview.Store
}

func newGhTestFixture(t *testing.T, remoteURL string) *ghTestFixture {
	t.Helper()
	reg := NewRegistry(githubRemoteRunner{url: remoteURL})
	watcherCh := make(chan *fakeWatcher, 1)
	reg.NewWatcher = func(gitclient.RepoSummary) (Watcher, error) {
		w := newFakeWatcher()
		watcherCh <- w
		return w, nil
	}
	store := gitreview.NewStore(filepath.Join(t.TempDir(), "review.db"))
	reg.Review = store
	t.Cleanup(func() { _ = store.Close() })

	ghRunner := &countingGhRunner{apiResult: ghclient.Result{ExitCode: 0, Stdout: openPullsJSON()}}
	reg.Gh = ghclient.NewClient(ghclient.NewDiscovery(fakeGhLocator{}, ghRunner, ghclient.NewRealClock()), ghRunner)

	entry, release, err := reg.Acquire(context.Background(), "git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	t.Cleanup(release)
	t.Cleanup(reg.Close)

	return &ghTestFixture{
		reg: reg, entry: entry, release: release,
		watcher: <-watcherCh, ghRunner: ghRunner, review: store,
	}
}

// --- cache hit/miss ------------------------------------------------------------------------------

func TestResolveCommitPr_CachesWithinTTL(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 0, Stdout: onePullJSON(1, "open", false, "feature")}

	r1 := f.entry.ResolveCommitPr(context.Background(), "sha1")
	if r1.Kind != "ok" || len(r1.PRs) != 1 {
		t.Fatalf("first resolve = %+v, want ok with one PR", r1)
	}
	before := f.ghRunner.count()

	r2 := f.entry.ResolveCommitPr(context.Background(), "sha1")
	if r2.Kind != "ok" || len(r2.PRs) != 1 {
		t.Fatalf("second resolve = %+v, want ok with one PR (cached)", r2)
	}
	if f.ghRunner.count() != before {
		t.Fatalf("gh runner was invoked again (%d -> %d) for a cached sha", before, f.ghRunner.count())
	}
}

func TestResolveCommitPr_DifferentShaMisses(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 0, Stdout: onePullJSON(1, "open", false, "feature")}

	f.entry.ResolveCommitPr(context.Background(), "sha1")
	before := f.ghRunner.count()
	f.entry.ResolveCommitPr(context.Background(), "sha2")
	if f.ghRunner.count() == before {
		t.Fatal("a different sha must not be served from sha1's own cache entry")
	}
}

// --- drop on refsChanged --------------------------------------------------------------------------

func TestRefsChanged_DropsCommitCache(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 0, Stdout: onePullJSON(1, "open", false, "feature")}

	f.entry.ResolveCommitPr(context.Background(), "sha1")
	before := f.ghRunner.count()

	f.watcher.Fire(gitclient.SignalRefsChanged)
	// note() drops synchronously before returning; the eager re-resolve pass runs in its own
	// goroutine and touches no state this assertion reads (no stored review session for any
	// branch in this fixture, so gitreview.Store.Branches returns empty and it does nothing).
	time.Sleep(20 * time.Millisecond)

	f.entry.ResolveCommitPr(context.Background(), "sha1")
	if f.ghRunner.count() == before {
		t.Fatal("refsChanged must drop the per-commit cache — the second resolve should have re-spawned")
	}
}

// --- the breaker suppresses spawns for its whole window -------------------------------------------

func TestBreaker_SuppressesFurtherSpawnsAfterRateLimit(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 1, Stderr: []byte("gh: API rate limit exceeded for user ID 1. (HTTP 403)")}

	r1 := f.entry.ResolveCommitPr(context.Background(), "sha1")
	if r1.Kind != "unavailable" || r1.Gh == nil || r1.Gh.Kind != ghclient.KindForbidden {
		t.Fatalf("r1 = %+v, want unavailable/forbidden", r1)
	}
	before := f.ghRunner.count()

	// A different, never-before-seen sha would ordinarily spawn again — the breaker must suppress
	// it regardless.
	r2 := f.entry.ResolveCommitPr(context.Background(), "sha-never-seen")
	if r2.Kind != "unavailable" || r2.Gh == nil || !strings.Contains(strings.ToLower(r2.Gh.Reason), "rate limit") {
		t.Fatalf("r2 = %+v, want the cached rate-limited forbidden", r2)
	}
	if f.ghRunner.count() != before {
		t.Fatalf("gh runner was invoked again (%d -> %d) while the breaker is armed", before, f.ghRunner.count())
	}
}

func TestBreaker_NotClearedByRefsChanged(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 1, Stderr: []byte("gh: API rate limit exceeded for user ID 1. (HTTP 403)")}
	f.entry.ResolveCommitPr(context.Background(), "sha1")
	before := f.ghRunner.count()

	f.watcher.Fire(gitclient.SignalRefsChanged)
	time.Sleep(20 * time.Millisecond)

	r := f.entry.ResolveCommitPr(context.Background(), "sha-different")
	if r.Kind != "unavailable" {
		t.Fatalf("r = %+v, want the breaker to still be armed after refsChanged (D7)", r)
	}
	if f.ghRunner.count() != before {
		t.Fatalf("gh runner was invoked (%d -> %d) despite the breaker surviving refsChanged", before, f.ghRunner.count())
	}
}

// --- Purge fires exactly once for closed/merged, never for open -----------------------------------

func seedReviewSession(t *testing.T, store *gitreview.Store, repoID, branch string) {
	t.Helper()
	rec := gitreview.FileRecord{
		Path: "a.txt", State: "full", ReviewedAtSHA: "sha1",
		ReviewedAt: time.UnixMilli(1000), BlobOID: "oid1",
		ContentKind: gitreview.ContentBinary,
	}
	if err := store.Put(context.Background(), repoID, branch, rec, nil); err != nil {
		t.Fatalf("seed review session: %v", err)
	}
}

func hasSession(t *testing.T, store *gitreview.Store, repoID, branch string) bool {
	t.Helper()
	recs, err := store.Records(context.Background(), repoID, branch)
	if err != nil {
		t.Fatalf("Records: %v", err)
	}
	return len(recs) > 0
}

func TestResolveBranchPr_PurgesOnClosed(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	repoID := f.entry.Summary.RepoID
	seedReviewSession(t, f.review, repoID, "feature")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 0, Stdout: onePullJSON(1, "closed", false, "feature")}

	r := f.entry.ResolveBranchPr(context.Background(), "feature")
	if r.Kind != "ok" || len(r.PRs) != 1 || r.PRs[0].State != "closed" {
		t.Fatalf("r = %+v, want ok/closed", r)
	}
	if hasSession(t, f.review, repoID, "feature") {
		t.Fatal("a closed PR must purge the branch's review session")
	}
}

func TestResolveBranchPr_PurgesOnMerged(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	repoID := f.entry.Summary.RepoID
	seedReviewSession(t, f.review, repoID, "feature")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 0, Stdout: onePullJSON(1, "merged", false, "feature")}

	r := f.entry.ResolveBranchPr(context.Background(), "feature")
	if r.Kind != "ok" || len(r.PRs) != 1 || r.PRs[0].State != "merged" {
		t.Fatalf("r = %+v, want ok/merged", r)
	}
	if hasSession(t, f.review, repoID, "feature") {
		t.Fatal("a merged PR must purge the branch's review session")
	}
}

func TestResolveBranchPr_NeverPurgesOnOpen(t *testing.T) {
	f := newGhTestFixture(t, "https://github.com/acme/widgets.git")
	repoID := f.entry.Summary.RepoID
	seedReviewSession(t, f.review, repoID, "feature")
	f.ghRunner.apiResult = ghclient.Result{ExitCode: 0, Stdout: onePullJSON(1, "open", false, "feature")}

	r := f.entry.ResolveBranchPr(context.Background(), "feature")
	if r.Kind != "ok" || len(r.PRs) != 1 || r.PRs[0].State != "open" {
		t.Fatalf("r = %+v, want ok/open", r)
	}
	if !hasSession(t, f.review, repoID, "feature") {
		t.Fatal("an open PR must never purge the branch's review session")
	}
}

// --- non-GitHub remote costs exactly zero ----------------------------------------------------------

func TestResolveCommitPr_NonGitHubRemoteNeverSpawns(t *testing.T) {
	f := newGhTestFixture(t, "https://gitlab.com/acme/widgets.git")
	r := f.entry.ResolveCommitPr(context.Background(), "sha1")
	if r.Kind != "disabled" {
		t.Fatalf("r = %+v, want disabled for a non-GitHub remote", r)
	}
	if f.ghRunner.count() != 0 {
		t.Fatalf("gh runner was invoked %d times for a non-GitHub remote, want 0", f.ghRunner.count())
	}
}
