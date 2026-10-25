package githostflow_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakehost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

// syncRig is a plain clone whose origin lives on the fake forge; no ADE task is involved.
type syncRig struct {
	t      *testing.T
	app    *flowharness.App
	forge  *fakehost.Forge
	dir    string
	gs     *flowharness.GitStream
	gitID  string
	events int
}

func newSyncRig(t *testing.T, forge *fakehost.Forge, opts ...flowharness.Opt) *syncRig {
	t.Helper()
	app := flowharness.New(t, append(opts, flowharness.WithGitHost(forge), flowharness.WithoutGh())...)
	dir := app.Work + "/r"
	bare := app.NewBare("r-remote")
	seed := app.NewRepo("r-seed")
	seed.Commit("base", map[string]string{"base.txt": "base\n"})
	bare.PushFrom(seed)
	bare.Clone(dir)
	git(t, dir, "remote", "set-url", "origin", "https://forge.test/acme/r.git")
	r := &syncRig{t: t, app: app, forge: forge, dir: dir}
	r.open()
	return r
}

func (r *syncRig) open() {
	r.t.Helper()
	r.gs = r.app.OpenGitStream()
	var opened gitrpc.RepoOpenResult
	r.gs.MustRequest("repo.open", gitrpc.RepoOpenParams{Path: r.dir}, &opened)
	if opened.Kind != "ok" || opened.Repo == nil {
		r.t.Fatalf("repo.open = %+v", opened)
	}
	r.gitID = opened.Repo.RepoID
	r.events = 0
}

func (r *syncRig) index() gitrpc.BranchChangeRequestIndexResult {
	r.t.Helper()
	return call[gitrpc.BranchChangeRequestIndexResult](r.t, r.gs, "branch.changeRequestIndex",
		gitrpc.BranchChangeRequestIndexParams{RepoID: r.gitID})
}

// sync runs one sync and waits for it to end.
func (r *syncRig) sync() {
	r.t.Helper()
	call[struct{}](r.t, r.gs, "branch.syncChangeRequests", gitrpc.BranchSyncChangeRequestsParams{RepoID: r.gitID, Wait: true})
}

// changedEvents is the count of changeRequestsChanged events pushed since the last open.
func (r *syncRig) changedEvents() int {
	n := 0
	for _, e := range r.gs.Events("repo.changed") {
		var p struct{ Kind string }
		if raw, ok := e.Data.(json.RawMessage); ok && json.Unmarshal(raw, &p) == nil && p.Kind == "changeRequestsChanged" {
			n++
		}
	}
	return n
}

func (r *syncRig) waitChanged(want int) {
	r.t.Helper()
	deadline := time.Now().Add(waitFor)
	for r.changedEvents() < want {
		if time.Now().After(deadline) {
			r.t.Fatalf("changeRequestsChanged events = %d, want %d", r.changedEvents(), want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (r *syncRig) byBranch() map[string][]gitrpc.ChangeRequestRecord {
	out := map[string][]gitrpc.ChangeRequestRecord{}
	for _, b := range r.index().Branches {
		out[b.Name] = b.ChangeRequests
	}
	return out
}

func cr(number int, state, head string, updated int64) githost.ChangeRequest {
	return githost.ChangeRequest{
		Number: number, Title: "PR " + head, State: state, HeadRef: head, HeadOwner: "acme", BaseRef: "main",
		HeadSha: "abc", UpdatedAt: updated, URL: "https://forge.test/acme/r/-/merge_requests/" + head,
	}
}

func seedForge() *fakehost.Forge {
	forge := fakehost.New()
	now := time.Now().UnixMilli()
	forge.AddChangeRequest(cr(1, "open", "feat/a", now-3000))
	forge.AddChangeRequest(cr(2, "merged", "feat/b", now-2000))
	forge.AddChangeRequest(cr(3, "draft", "feat/c", now-1000))
	return forge
}

// Cold load backfills every change request once; a relaunch serves the index before any host
// call and then asks the host only whether anything changed.
func TestChangeRequestIndexColdAndRestart(t *testing.T) {
	forge := seedForge()
	r := newSyncRig(t, forge)

	if ix := r.index(); ix.Complete || len(ix.Branches) != 0 {
		t.Fatalf("index before any sync = %+v, want empty", ix)
	}
	r.sync()
	ix := r.index()
	if !ix.Complete || ix.SyncedAt == 0 || len(ix.Branches) != 3 {
		t.Fatalf("index after backfill = %+v, want complete with 3 branches", ix)
	}
	by := r.byBranch()
	if by["feat/a"][0].State != "open" || by["feat/b"][0].State != "merged" || !by["feat/c"][0].Draft {
		t.Fatalf("index rows = %+v, want open, merged and a draft", by)
	}
	if n := forge.Count("Page:"); n != 1 {
		t.Fatalf("Page calls after backfill = %d, want 1", n)
	}

	r.app.Restart()
	before := len(forge.Calls())
	r.open()
	if ix := r.index(); !ix.Complete || len(ix.Branches) != 3 {
		t.Fatalf("index after restart = %+v, want the persisted 3 branches", ix)
	}
	if got := len(forge.Calls()); got != before {
		t.Fatalf("host calls before the first sync after restart = %v, want none", forge.Calls()[before:])
	}
	r.sync()
	for _, c := range forge.Calls()[before:] {
		if c != "Probe:304" && c[:7] != "Checks:" {
			t.Fatalf("host call after restart = %q, want only Probe:304 (and the first sweep's Checks)", c)
		}
	}
	if forge.Count("Probe:304") != 1 || forge.Count("Page:") != 1 {
		t.Fatalf("calls = %v, want one 304 probe and no new page", forge.Calls())
	}
}

// A delta fetches only what changed: a new change request and a state change arrive in one page,
// and one changeRequestsChanged event announces them.
func TestChangeRequestIndexDelta(t *testing.T) {
	forge := seedForge()
	r := newSyncRig(t, forge)
	r.sync()
	r.waitChanged(1)

	now := time.Now().UnixMilli()
	forge.SetChangeRequest(cr(1, "merged", "feat/a", now))
	forge.AddChangeRequest(cr(4, "open", "feat/d", now))
	pages, probes := forge.Count("Page:"), forge.Count("Probe:200")
	r.sync()
	r.waitChanged(2)

	if forge.Count("Probe:200")-probes != 1 || forge.Count("Page:")-pages != 1 {
		t.Fatalf("calls = %v, want one 200 probe and one extra page", forge.Calls())
	}
	by := r.byBranch()
	if by["feat/a"][0].State != "merged" || by["feat/d"][0].Number != 4 || len(by) != 4 {
		t.Fatalf("index after delta = %+v, want feat/a merged and feat/d added", by)
	}
	if got := r.changedEvents(); got != 2 {
		t.Fatalf("changeRequestsChanged events = %d, want 2", got)
	}

	// Nothing changed: a 304 probe, no page, no event.
	r.sync()
	if forge.Count("Page:")-pages != 1 || r.changedEvents() != 2 {
		t.Fatalf("an unchanged sync fetched a page or pushed an event: %v", forge.Calls())
	}
}

// CI results move without the listing changing, so a pending check refreshes on its own and a
// change request the host dropped leaves the index.
func TestChangeRequestIndexChecksAndDeletion(t *testing.T) {
	forge := fakehost.New()
	now := time.Now().UnixMilli()
	pending := cr(1, "open", "feat/a", now-2000)
	pending.ChecksState = "PENDING"
	forge.AddChangeRequest(pending)
	alsoPending := cr(2, "open", "feat/b", now-1000)
	alsoPending.ChecksState = "PENDING"
	forge.AddChangeRequest(alsoPending)
	r := newSyncRig(t, forge)
	r.sync()
	r.waitChanged(1)
	if got := r.byBranch()["feat/a"][0].ChecksState; got != "PENDING" {
		t.Fatalf("checks state = %q, want PENDING", got)
	}

	forge.SetChecksState(1, "SUCCESS")
	r.sync()
	r.waitChanged(2)
	if got := r.byBranch()["feat/a"][0].ChecksState; got != "SUCCESS" {
		t.Fatalf("checks state after refresh = %q, want SUCCESS", got)
	}
	if forge.Count("Probe:304") == 0 {
		t.Fatalf("calls = %v, want the listing probed unchanged while checks moved", forge.Calls())
	}

	// Deleted on the host while its checks were pending: the refresh finds the node missing.
	forge.RemoveChangeRequest(2)
	r.sync()
	if _, ok := r.byBranch()["feat/b"]; ok {
		t.Fatalf("index still holds the deleted change request: %+v", r.byBranch())
	}
}

// A different signed-in account sees other change requests, so the cached index is dropped and
// rebuilt rather than served.
func TestChangeRequestIndexAccountChange(t *testing.T) {
	forge := seedForge()
	r := newSyncRig(t, forge)
	r.sync()
	forge.SetAccount("someone-else")
	forge.RemoveChangeRequest(2)
	pages := forge.Count("Page:")
	r.sync()
	if forge.Count("Page:") != pages+1 {
		t.Fatalf("calls = %v, want a full backfill after the account change", forge.Calls())
	}
	if by := r.byBranch(); len(by) != 2 || by["feat/b"] != nil {
		t.Fatalf("index after account change = %+v, want the 2 remaining branches", by)
	}
}

// A rate limited host is not called again before its reset, and the cached index keeps serving.
func TestChangeRequestIndexRateLimit(t *testing.T) {
	forge := seedForge()
	r := newSyncRig(t, forge)
	r.sync()

	forge.SetChangeRequest(cr(1, "closed", "feat/a", time.Now().UnixMilli()))
	forge.SetRateLimited(time.Now().Add(time.Hour))
	r.sync()
	limited := len(forge.Calls())
	r.sync()
	r.sync()
	if got := len(forge.Calls()); got != limited {
		t.Fatalf("host calls while rate limited: %v, want none after the first rejection", forge.Calls()[limited:])
	}
	if ix := r.index(); !ix.Complete || ix.Branches == nil || r.byBranch()["feat/a"][0].State != "open" {
		t.Fatalf("index while rate limited = %+v, want the cached rows", ix)
	}
}
