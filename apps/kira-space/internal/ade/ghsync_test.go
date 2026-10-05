package ade

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
)

type fakeGhLocator struct{}

func (fakeGhLocator) Locate() (string, []string, bool) { return "/fake/gh", nil, true }

type fakeGhClock struct{}

func (fakeGhClock) Now() time.Time { return time.Unix(1700000000, 0) }

// fakeGh answers the gh calls a sync makes: one open PR for branch "a", file viewed state in memory,
// mutations logged. failPaths make their alias fail.
type fakeGh struct {
	mu        sync.Mutex
	headSha   string
	viewed    map[string]bool
	files     []string
	failPaths map[string]bool
	mutations []string // "mark:<path>" | "unmark:<path>"
}

func (f *fakeGh) Run(_ context.Context, _ string, spec ghclient.Spec) (ghclient.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	args := spec.Args
	ok := func(body string) (ghclient.Result, error) { return ghclient.Result{Stdout: []byte(body)}, nil }
	switch {
	case args[0] == "--version":
		return ok("gh version 2.42.0 (2024-01-08)\n")
	case args[0] == "auth":
		return ok("Logged in to github.com account octocat (keyring)\n")
	}
	if args[1] != "graphql" {
		pr := map[string]any{
			"number": 7, "title": "t", "html_url": "https://github.com/acme/r/pull/7", "state": "open",
			"head": map[string]any{"ref": "a", "sha": f.headSha, "repo": map[string]any{"owner": map[string]any{"login": "acme"}}},
			"base": map[string]any{"ref": "main"}, "updated_at": "2026-01-01T00:00:00Z",
		}
		body, _ := json.Marshal([]any{pr})
		return ok(string(body))
	}
	var query string
	vars := map[string]string{}
	for i := 0; i+1 < len(args); i++ {
		if args[i] != "-f" && args[i] != "-F" {
			continue
		}
		k, v, _ := strings.Cut(args[i+1], "=")
		if k == "query" {
			query = v
		} else {
			vars[k] = v
		}
	}
	if !strings.HasPrefix(query, "mutation") {
		nodes := make([]map[string]string, 0, len(f.files))
		for _, p := range f.files {
			state := "UNVIEWED"
			if f.viewed[p] {
				state = "VIEWED"
			}
			nodes = append(nodes, map[string]string{"path": p, "viewerViewedState": state})
		}
		body, _ := json.Marshal(map[string]any{"data": map[string]any{"repository": map[string]any{"pullRequest": map[string]any{
			"id": "PR_7", "headRefOid": f.headSha, "state": "OPEN",
			"files": map[string]any{"nodes": nodes, "pageInfo": map[string]any{"hasNextPage": false}},
		}}}})
		return ok(string(body))
	}
	verb, want := "unmark", false
	if strings.Contains(query, "markFileAsViewed") && !strings.Contains(query, "unmarkFileAsViewed") {
		verb, want = "mark", true
	}
	data := map[string]any{}
	var errs []map[string]any
	for i := 0; ; i++ {
		path, has := vars[fmt.Sprintf("p%d", i)]
		if !has {
			break
		}
		alias := fmt.Sprintf("m%d", i)
		if f.failPaths[path] {
			data[alias] = nil
			errs = append(errs, map[string]any{"message": "boom", "path": []string{alias}})
			continue
		}
		data[alias] = map[string]any{"clientMutationId": nil}
		f.viewed[path] = want
		f.mutations = append(f.mutations, verb+":"+path)
	}
	out := map[string]any{"data": data}
	code := 0
	if len(errs) > 0 {
		out["errors"] = errs
		code = 1
	}
	body, _ := json.Marshal(out)
	return ghclient.Result{Stdout: body, ExitCode: code}, nil
}

func (f *fakeGh) log() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.mutations...)
}

type ghSyncHarness struct {
	*boardHarness
	gh    *fakeGh
	entry interface {
		MarkFile(ctx context.Context, branch, path string, reviewed bool, ranges []gitreview.LineRange) (gitreview.FileRecord, error)
	}
}

func newGhSyncHarness(t *testing.T) *ghSyncHarness {
	t.Helper()
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	_, dir := initQueueRepo(t)
	runGitQueue(t, dir, "remote", "set-url", "origin", "https://github.com/acme/r.git")
	h.addRepo("r", dir)
	wt := addQueueWorktree(t, dir, "a", "main")
	commitFile(t, wt, "a.txt", "a\n", "a")
	commitFile(t, wt, "b.txt", "b\n", "b")
	tip := runGitQueue(t, wt, "rev-parse", "HEAD")

	gh := &fakeGh{headSha: strings.TrimSpace(tip), viewed: map[string]bool{}, files: []string{"a.txt", "b.txt"}, failPaths: map[string]bool{}}
	reg := h.board.deps.Registry
	store := gitreview.NewStore(filepath.Join(t.TempDir(), "review.db"))
	t.Cleanup(func() { _ = store.Close() })
	reg.Review = store
	reg.Gh = ghclient.NewClient(ghclient.NewDiscovery(fakeGhLocator{}, gh, fakeGhClock{}), gh)
	h.board.deps.GhSynced = h.repos.AdeGhSynced
	h.addTask("T", "task", branchSpec{id: "b1", repo: "r", name: "a", kind: "mine"})
	h.board.WatchReviews()

	entry, err := h.board.openRepo(context.Background(), "r")
	if err != nil {
		t.Fatal(err)
	}
	return &ghSyncHarness{boardHarness: h, gh: gh, entry: entry}
}

func (h *ghSyncHarness) synced() map[string]int {
	h.t.Helper()
	m, err := h.repos.AdeGhSynced.Paths("b1")
	if err != nil {
		h.t.Fatal(err)
	}
	return m
}

func (h *ghSyncHarness) review(path string, reviewed bool) {
	h.t.Helper()
	if _, err := h.entry.MarkFile(context.Background(), "a", path, reviewed, nil); err != nil {
		h.t.Fatalf("MarkFile %s: %v", path, err)
	}
}

func (h *ghSyncHarness) syncA() {
	h.t.Helper()
	h.review("a.txt", true)
	res, err := h.board.GitHubSyncApply(context.Background(), "b1")
	if err != nil || res.Status != "ok" || len(res.Marked) != 1 || res.Marked[0] != "a.txt" {
		h.t.Fatalf("apply = %+v err=%v, want a.txt marked", res, err)
	}
	if _, ok := h.synced()["a.txt"]; !ok {
		h.t.Fatalf("ledger = %v, want a.txt", h.synced())
	}
}

func TestGitHubSync_UnreviewUnmarksOnGitHub(t *testing.T) {
	h := newGhSyncHarness(t)
	h.syncA()
	h.review("a.txt", false)
	h.board.wg.Wait()
	if got := h.gh.log(); len(got) != 2 || got[1] != "unmark:a.txt" {
		t.Fatalf("mutations = %v, want mark then unmark of a.txt", got)
	}
	if len(h.synced()) != 0 {
		t.Fatalf("ledger = %v, want empty", h.synced())
	}
}

func TestGitHubSync_ReReviewBeforeWorkerSendsNoUnmark(t *testing.T) {
	h := newGhSyncHarness(t)
	h.syncA()
	lock := h.board.ghLock("b1")
	lock.Lock()
	h.review("a.txt", false)
	h.review("a.txt", true)
	lock.Unlock()
	h.board.wg.Wait()
	if got := h.gh.log(); len(got) != 1 {
		t.Fatalf("mutations = %v, want only the mark", got)
	}
	if _, ok := h.synced()["a.txt"]; !ok {
		t.Fatal("ledger lost a.txt although it is reviewed again")
	}
}

func TestGitHubSync_FailedUnmarkKeepsLedgerRow(t *testing.T) {
	h := newGhSyncHarness(t)
	h.syncA()
	h.gh.mu.Lock()
	h.gh.failPaths["a.txt"] = true
	h.gh.mu.Unlock()
	h.review("a.txt", false)
	h.board.wg.Wait()
	if _, ok := h.synced()["a.txt"]; !ok {
		t.Fatal("ledger row dropped although GitHub rejected the unmark")
	}
	if got := h.gh.log(); len(got) != 1 {
		t.Fatalf("mutations = %v, want only the mark", got)
	}
}
