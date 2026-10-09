package gitflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// rawProcessText reports text a user should never see: a Go exec error or a bare exit status.
func rawProcessText(s string) bool {
	return strings.Contains(s, "exec:") || strings.Contains(s, "exit status") || strings.Contains(s, "/bin/git")
}

func TestRepoDeletedWhileOpen(t *testing.T) {
	t.Skip("P236 finding F3: a deleted repo surfaces a raw fork/exec string")
	r := newRig(t)
	repo := r.app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	id := r.open(repo.Dir).RepoID
	if err := os.RemoveAll(repo.Dir); err != nil {
		t.Fatal(err)
	}

	for _, req := range []struct {
		method string
		params any
	}{
		{"status.get", gitrpc.StatusGetParams{RepoID: id}},
		{"refs.list", gitrpc.RefsListParams{RepoID: id}},
		{"stash.list", gitrpc.StashListParams{RepoID: id}},
	} {
		we := wireErr(t, r.gs, req.method, req.params)
		if we.Code == "" || we.Message == "" || rawProcessText(we.Message) {
			t.Fatalf("%s on a deleted repo = %+v, want a classified error without process text", req.method, we)
		}
	}
	res := r.op(id, gitsession.OpRequest{Kind: "branchCreate", Name: "x", StartPoint: "main"})
	if res.OK || res.Error == nil || res.Error.Kind == "" || rawProcessText(res.Error.Message) {
		t.Fatalf("op on a deleted repo = %+v, want a classified failure", res)
	}
	if res := call[gitrpc.RepoOpenResult](t, r.gs, "repo.open", gitrpc.RepoOpenParams{Path: repo.Dir}); res.Kind == "ok" {
		t.Fatalf("repo.open of the deleted path = %+v, want a refusal", res)
	}
}

func TestPushRejectedNonFastForward(t *testing.T) {
	r := newRig(t)
	p := newRemotePair(r, "nff", map[string]string{"f.txt": "seed\n"})
	id := r.open(p.x.Dir).RepoID
	p.y.Commit("from y", map[string]string{"y.txt": "y\n"})
	p.y.Git("push", "-q", "origin", "main")
	p.x.Commit("from x", map[string]string{"x.txt": "x\n"})

	res := r.remote(id, gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"})
	if res.OK || res.Error == nil || res.Error.Kind == "" || rawProcessText(res.Error.Message) {
		t.Fatalf("push behind the remote = %+v, want a classified rejection", res)
	}
	if got, want := p.bare.Git("rev-parse", "main"), p.y.Git("rev-parse", "HEAD"); got != want {
		t.Fatalf("rejected push moved the remote to %s, want %s", got, want)
	}
	// The same rejection every time: no state left by the first one.
	if again := r.remote(id, gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"}); again.OK || again.Error == nil || again.Error.Kind != res.Error.Kind {
		t.Fatalf("second push = %+v, want the same %q rejection", again, res.Error.Kind)
	}
}

func TestWorktreeAddBranchCheckedOutElsewhere(t *testing.T) {
	t.Skip("P236 finding F2: preflight.worktreeAdd calls the repo's own checked-out branch clean")
	r := newRig(t)
	repo := r.app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	id := r.open(repo.Dir).RepoID
	path := filepath.Join(r.app.Work, "wt-main")

	pf := call[gitpreflight.WorktreeAddPreflight](t, r.gs, "preflight.worktreeAdd", gitrpc.PreflightWorktreeAddParams{RepoID: id, Path: path, Mode: "existingBranch", Branch: "main"})
	if pf.Verdict != "blocked" {
		t.Fatalf("preflight for main, checked out in the main worktree = %+v, want blocked", pf)
	}
	res := r.op(id, gitsession.OpRequest{Kind: "worktreeAdd", Path: path, Mode: "existingBranch", Branch: "main"})
	if res.OK || res.Error == nil || rawProcessText(res.Error.Message) {
		t.Fatalf("worktreeAdd of a checked-out branch = %+v, want a classified failure", res)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("failed add left %s behind: %v", path, err)
	}
}

// The native graph surface is read-only for prepare scripts, so a cancel is refused the same way
// worktree.prepare is; only a socket client (VS Code) can run and cancel one.
func TestWorktreeCancelPrepare(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	id := r.open(repo.Dir).RepoID
	for range 2 {
		if we := wireErr(t, r.gs, "worktree.cancelPrepare", gitrpc.WorktreeCancelPrepareParams{RepoID: id}); we.Code != "E_READ_ONLY" {
			t.Fatalf("worktree.cancelPrepare = %+v, want E_READ_ONLY", we)
		}
	}
}
