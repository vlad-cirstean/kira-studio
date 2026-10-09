package gitflow_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// featPair is a remote pair with feat pushed and tracked from x, and y holding the same branch.
func featPair(r *rig, tag string) remotePair {
	r.t.Helper()
	p := newRemotePair(r, tag, map[string]string{"f.txt": "seed\n"})
	p.x.Git("checkout", "-q", "-b", "feat")
	p.x.Commit("feat work", map[string]string{"feat.txt": "feat\n"})
	p.x.Git("push", "-q", "-u", "origin", "feat")
	p.y.Git("fetch", "-q", "origin")
	p.y.Git("checkout", "-q", "-b", "feat", "origin/feat")
	return p
}

func remoteFailure(t *testing.T, res gitsession.RemoteOpResult, kind string) *gitsession.RemoteOpError {
	t.Helper()
	if res.OK || res.Error == nil || res.Error.Kind != kind {
		t.Fatalf("remote op = %+v, want %s", res, kind)
	}
	return res.Error
}

func TestForcePushLeaseGuards(t *testing.T) {
	forcePush := func(tip string) gitsession.RemoteOpParams {
		return gitsession.RemoteOpParams{Kind: "forcePush", Remote: "origin", Branch: "feat", ExpectedRemoteTip: &tip}
	}

	t.Run("never fetched", func(t *testing.T) {
		r := newRig(t)
		p := featPair(r, "lease-a")
		id := r.open(p.x.Dir).RepoID
		known := p.x.Git("rev-parse", "origin/feat")
		p.y.Commit("diverge", map[string]string{"y.txt": "y\n"})
		p.y.Git("push", "-q", "origin", "feat")
		moved := p.bare.Git("rev-parse", "feat")

		remoteFailure(t, r.remote(id, forcePush(known)), "LeaseViolation")
		if got := p.bare.Git("rev-parse", "feat"); got != moved {
			t.Fatalf("remote feat = %s, want unchanged %s", got, moved)
		}
	})

	t.Run("fetched but not integrated", func(t *testing.T) {
		r := newRig(t)
		p := featPair(r, "lease-b")
		id := r.open(p.x.Dir).RepoID
		p.y.Commit("diverge", map[string]string{"y.txt": "y\n"})
		p.y.Git("push", "-q", "origin", "feat")
		moved := p.bare.Git("rev-parse", "feat")
		if res := r.remote(id, gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}); !res.OK {
			t.Fatalf("fetch = %+v", res.Error)
		}

		remoteFailure(t, r.remote(id, forcePush(moved)), "RemoteRefUpdated")
		if got := p.bare.Git("rev-parse", "feat"); got != moved {
			t.Fatalf("remote feat = %s, want unchanged %s", got, moved)
		}
	})

	t.Run("stale expected tip", func(t *testing.T) {
		r := newRig(t)
		p := featPair(r, "lease-c")
		id := r.open(p.x.Dir).RepoID
		before := p.bare.Git("rev-parse", "feat")

		remoteFailure(t, r.remote(id, forcePush("0000000000000000000000000000000000000000")), "LeaseViolation")
		if got := p.bare.Git("rev-parse", "feat"); got != before {
			t.Fatalf("remote feat = %s, want unchanged %s", got, before)
		}
	})
}

func TestPushRefusals(t *testing.T) {
	t.Run("hook rejection carries the hook message", func(t *testing.T) {
		r := newRig(t)
		p := newRemotePair(r, "hook", map[string]string{"f.txt": "seed\n"})
		hook := "#!/bin/sh\necho 'policy: no pushes on Fridays' >&2\nexit 1\n"
		if err := os.WriteFile(filepath.Join(p.bare.Dir, "hooks", "pre-receive"), []byte(hook), 0o755); err != nil {
			t.Fatal(err)
		}
		id := r.open(p.x.Dir).RepoID
		p.x.Commit("rejected", map[string]string{"x.txt": "x\n"})

		e := remoteFailure(t, r.remote(id, gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"}), "HookRejected")
		if e.RemoteMessage == nil || *e.RemoteMessage != "policy: no pushes on Fridays" {
			t.Fatalf("remoteMessage = %v, want the hook output", e.RemoteMessage)
		}
	})

	t.Run("protected branch rejects a wrong token", func(t *testing.T) {
		r := newRig(t)
		p := newRemotePair(r, "protected", map[string]string{"f.txt": "seed\n"})
		id := r.open(p.x.Dir).RepoID
		tip := p.bare.Git("rev-parse", "main")

		res := r.remote(id, gitsession.RemoteOpParams{
			Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &tip, ConfirmToken: "not-main",
		})
		remoteFailure(t, res, "ProtectedBranch")
		if got := p.bare.Git("rev-parse", "main"); got != tip {
			t.Fatalf("remote main = %s, want unchanged %s", got, tip)
		}
	})
}

func TestPullRefusedWhenAnotherBranchIsCheckedOut(t *testing.T) {
	r := newRig(t)
	p := newRemotePair(r, "branch-changed", map[string]string{"f.txt": "seed\n"})
	p.y.Commit("remote only", map[string]string{"y.txt": "y\n"})
	p.y.Git("push", "-q", "origin", "main")
	p.x.Git("checkout", "-q", "-b", "other")
	head := p.x.Git("rev-parse", "HEAD")
	id := r.open(p.x.Dir).RepoID

	remoteFailure(t, r.remote(id, gitsession.RemoteOpParams{
		Kind: "pull", Remote: "origin", Branch: "main", Strategy: string(gitpreflight.PullFFOnly),
	}), "BranchChanged")
	if got := p.x.Git("rev-parse", "HEAD"); got != head {
		t.Fatalf("HEAD = %s after refused pull, want %s", got, head)
	}
	if got := p.x.Git("rev-parse", "--abbrev-ref", "HEAD"); got != "other" {
		t.Fatalf("branch = %s after refused pull, want other", got)
	}
}

func TestPullPreflightHonorsStoredStrategy(t *testing.T) {
	r := newRig(t)
	p := newRemotePair(r, "strategy", map[string]string{"f.txt": "seed\n"})
	id := r.open(p.x.Dir).RepoID
	rebase := "rebase"
	r.setSettings(id, gitrpc.RepoSettingsPatchWire{PullStrategy: &rebase})
	p.x.Git("config", "pull.rebase", "merges")

	pf := call[gitpreflight.PullPreflight](t, r.gs, "remote.pullPreflight", gitrpc.RemotePullPreflightParams{RepoID: id, Branch: "main"})
	if pf.Strategy != gitpreflight.PullRebase || pf.Source != gitpreflight.SourceSetting || pf.RebaseMerges {
		t.Fatalf("preflight = %+v, want rebase from the stored setting without rebaseMerges", pf)
	}
}

func TestFetchIgnoresStaleAskpassDirectory(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	stale := filepath.Join(tmp, "kira-askpass-stale")
	if err := os.Mkdir(stale, 0o700); err != nil {
		t.Fatal(err)
	}
	r := newRig(t)
	p := newRemotePair(r, "askpass", map[string]string{"f.txt": "seed\n"})
	id := r.open(p.x.Dir).RepoID
	p.y.Commit("remote", map[string]string{"y.txt": "y\n"})
	p.y.Git("push", "-q", "origin", "main")

	if res := r.remote(id, gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}); !res.OK {
		t.Fatalf("fetch with a stale askpass directory = %+v", res.Error)
	}
}
