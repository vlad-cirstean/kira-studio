package gitflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// remotePair is a bare remote with two clones, x (the app's) and y (another machine).
type remotePair struct {
	bare *flowharness.Bare
	x, y *flowharness.Repo
}

func newRemotePair(r *rig, tag string, files map[string]string) remotePair {
	r.t.Helper()
	seed := r.app.NewRepo("seed-" + tag)
	seed.Commit("seed", files)
	bare := r.app.NewBare("remote-" + tag)
	bare.PushFrom(seed)
	return remotePair{
		bare: bare,
		x:    bare.Clone(filepath.Join(r.app.Work, "x-"+tag)),
		y:    bare.Clone(filepath.Join(r.app.Work, "y-"+tag)),
	}
}

func trackOf(t *testing.T, refs gitsession.RefsResult, branch string) (ahead, behind int) {
	t.Helper()
	for _, b := range refs.Branches {
		if b.ShortName != branch {
			continue
		}
		track, ok := b.Track.(map[string]any)
		if !ok {
			return 0, 0
		}
		a, _ := track["ahead"].(float64)
		bh, _ := track["behind"].(float64)
		return int(a), int(bh)
	}
	t.Fatalf("branch %q not in refs.list", branch)
	return 0, 0
}

func TestRemoteFetchPullPush(t *testing.T) {
	r := newRig(t)
	p := newRemotePair(r, "a", map[string]string{"f.txt": "seed\n"})
	id := r.open(p.x.Dir).RepoID

	yTip := p.y.Commit("from y", map[string]string{"y.txt": "y\n"})
	p.y.Git("push", "-q", "origin", "main")

	fetch := r.remote(id, gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"})
	if !fetch.OK || len(fetch.Updates) == 0 {
		t.Fatalf("fetch = %+v, want ok with ref updates", fetch)
	}
	r.app.Contract(t, "git-remote", "git:refs.list#behind", r.refs(id), flowharness.Mask("objectId", "committerDate"))
	if ahead, behind := trackOf(t, r.refs(id), "main"); ahead != 0 || behind != 1 {
		t.Fatalf("main ahead/behind = %d/%d after fetch, want 0/1", ahead, behind)
	}

	pf := call[gitpreflight.PullPreflight](t, r.gs, "remote.pullPreflight", gitrpc.RemotePullPreflightParams{RepoID: id, Branch: "main"})
	r.app.Contract(t, "git-remote", "git:remote.pullPreflight#behind", pf)
	if pf.Behind != 1 || pf.Ahead != 0 || pf.Strategy != gitpreflight.PullStrategy("ff-only") {
		t.Fatalf("pull preflight = %+v, want behind 1 with ff-only", pf)
	}
	pull := r.remote(id, gitsession.RemoteOpParams{Kind: "pull", Remote: "origin", Branch: "main", Strategy: string(pf.Strategy)})
	if !pull.OK || p.x.Git("rev-parse", "HEAD") != yTip {
		t.Fatalf("pull = %+v, HEAD %s, want %s", pull, p.x.Git("rev-parse", "HEAD"), yTip)
	}

	xTip := p.x.Commit("from x", map[string]string{"x.txt": "x\n"})
	push := call[gitpreflight.PushPreflight](t, r.gs, "remote.pushPreflight", gitrpc.RemotePushPreflightParams{RepoID: id, Branch: "main", Remote: "origin"})
	r.app.Contract(t, "git-remote", "git:remote.pushPreflight#ahead", push, flowharness.Mask("remoteTip", "localTip"))
	if push.Ahead != 1 || push.Behind != 0 || !push.FastForward {
		t.Fatalf("push preflight = %+v, want ahead 1, fast-forward", push)
	}
	if res := r.remote(id, gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"}); !res.OK {
		t.Fatalf("push = %+v", res.Error)
	}
	if got := p.bare.Git("rev-parse", "main"); got != xTip {
		t.Fatalf("remote main = %s, want %s", got, xTip)
	}

	// Rewrite the pushed commit: the plain push is refused, the force push needs the typed token and a fresh lease.
	r.external(func() { gitNow(t, p.x.Dir, "commit", "-q", "--amend", "-m", "from x, amended") })
	amended := p.x.Git("rev-parse", "HEAD")
	push = call[gitpreflight.PushPreflight](t, r.gs, "remote.pushPreflight", gitrpc.RemotePushPreflightParams{RepoID: id, Branch: "main", Remote: "origin"})
	if push.FastForward || push.ProtectedBy == nil || push.RemoteTip == nil || *push.RemoteTip != xTip {
		t.Fatalf("push preflight after amend = %+v, want not fast-forward, protected, remote tip %s", push, xTip)
	}
	if res := r.remote(id, gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"}); res.OK {
		t.Fatal("plain push of a rewritten branch succeeded")
	}
	force := gitsession.RemoteOpParams{Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: push.RemoteTip}
	if res := r.remote(id, force); res.OK || res.Error == nil || res.Error.Kind != "ProtectedBranch" {
		t.Fatalf("force push without the token = %+v, want ProtectedBranch", res)
	}
	if p.bare.Git("rev-parse", "main") != xTip {
		t.Fatal("refused force push moved the remote")
	}
	force.ConfirmToken = push.ResolvedBranch
	if res := r.remote(id, force); !res.OK {
		t.Fatalf("confirmed force push = %+v", res.Error)
	}
	if got := p.bare.Git("rev-parse", "main"); got != amended {
		t.Fatalf("remote main = %s after force push, want %s", got, amended)
	}

	p.x.Git("branch", "tmp")
	if res := r.remote(id, gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "tmp", SetUpstream: true}); !res.OK {
		t.Fatalf("push tmp = %+v", res.Error)
	}
	if !strings.Contains(p.bare.Git("branch", "--list", "tmp"), "tmp") {
		t.Fatal("tmp is not on the remote")
	}
	if res := r.remote(id, gitsession.RemoteOpParams{Kind: "deleteRemoteBranch", Remote: "origin", Branch: "tmp"}); !res.OK {
		t.Fatalf("delete remote branch = %+v", res.Error)
	}
	if out := p.bare.Git("branch", "--list", "tmp"); out != "" {
		t.Fatalf("tmp still on the remote: %q", out)
	}

	t.Run("pull with merge and rebase on a diverged branch", func(t *testing.T) {
		flowharness.Complete(t)
		for _, strategy := range []string{"merge", "rebase"} {
			for _, conflict := range []bool{false, true} {
				name := strategy + map[bool]string{false: " clean", true: " conflict"}[conflict]
				t.Run(name, func(t *testing.T) {
					rr := newRig(t)
					tag := strings.ReplaceAll(name, " ", "-")
					pair := newRemotePair(rr, tag, map[string]string{"f.txt": "seed\n"})
					rid := rr.open(pair.x.Dir).RepoID
					theirs, ours := "y.txt", "x.txt"
					if conflict {
						theirs, ours = "f.txt", "f.txt"
					}
					pair.y.Commit("theirs", map[string]string{theirs: "theirs\n"})
					pair.y.Git("push", "-q", "origin", "main")
					localTip := pair.x.Commit("ours", map[string]string{ours: "ours\n"})
					if res := rr.remote(rid, gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}); !res.OK {
						t.Fatalf("fetch = %+v", res.Error)
					}
					res := rr.remote(rid, gitsession.RemoteOpParams{Kind: "pull", Remote: "origin", Branch: "main", Strategy: strategy})
					if !conflict {
						if !res.OK || res.InProgress != nil {
							t.Fatalf("clean %s pull = %+v", strategy, res)
						}
						parents := strings.Fields(pair.x.Git("log", "-1", "--format=%P"))
						if (strategy == "merge") != (len(parents) == 2) {
							t.Fatalf("%s pull left %d parents on HEAD", strategy, len(parents))
						}
						return
					}
					if res.OK || res.InProgress == nil {
						t.Fatalf("conflicting %s pull = %+v, want an operation in progress", strategy, res)
					}
					rr.mustOp(rid, gitsession.OpRequest{Kind: "opAbort"})
					if got := pair.x.Git("rev-parse", "HEAD"); got != localTip {
						t.Fatalf("HEAD after abort = %s, want %s", got, localTip)
					}
					res = rr.remote(rid, gitsession.RemoteOpParams{Kind: "pull", Remote: "origin", Branch: "main", Strategy: strategy})
					if res.OK || res.InProgress == nil {
						t.Fatalf("second conflicting pull = %+v", res)
					}
					if err := os.WriteFile(filepath.Join(pair.x.Dir, "f.txt"), []byte("resolved\n"), 0o644); err != nil {
						t.Fatal(err)
					}
					pair.x.Git("add", "f.txt")
					done := rr.mustOp(rid, gitsession.OpRequest{Kind: "opContinue"})
					if done.InProgress != nil || pair.x.Git("status", "--porcelain") != "" {
						t.Fatalf("after continue: %+v, status %q", done.InProgress, pair.x.Git("status", "--porcelain"))
					}
				})
			}
		}
	})
}
