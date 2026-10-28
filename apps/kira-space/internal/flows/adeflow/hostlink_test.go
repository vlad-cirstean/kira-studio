package adeflow_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
)

type hostLinkFixture struct {
	app      *flowharness.App
	repoID   string
	forkTip  string
	clone    *flowharness.Repo
	authFail bool
}

// pullJSON is a GitHub pull response.
func pullJSON(number int, title, headRef, headOwner, login, mergedAt string) string {
	merged := "null"
	if mergedAt != "" {
		merged = `"` + mergedAt + `"`
	}
	return fmt.Sprintf(`{"number":%d,"title":%q,"html_url":"https://github.com/acme/api/pull/%d","state":"open","draft":false,`+
		`"merged_at":%s,"user":{"login":%q},"head":{"ref":%q,"sha":"x","repo":{"owner":{"login":%q}}},"base":{"ref":"main"},"updated_at":"2026-03-01T00:00:00Z"}`,
		number, title, number, merged, login, headRef, headOwner)
}

// newHostLinkFixture builds a base repo served at github.com/acme/api over a local ssh stand-in:
// git reads the GitHub remote URL, the stand-in runs the server side in the hub directory.
func newHostLinkFixture(t *testing.T, authFail bool) *hostLinkFixture {
	t.Helper()
	// A sandbox may rewrite git@github.com: to https through GIT_CONFIG_* and set its own ssh command.
	t.Setenv("GIT_CONFIG_COUNT", "0")
	app := flowharness.New(t)
	hub := filepath.Join(app.Work, "hub")
	base := flowharness.BareRemote(t, filepath.Join(hub, "acme", "api.git"))

	seed := app.NewRepo("api-seed")
	commitAs := func(email, msg, file string) {
		seed.Write(file, msg+"\n")
		seed.Git("add", "-A")
		seed.Git("commit", "-q", "--author=Dev <"+email+">", "-m", msg)
	}
	commitAs("me@example.com", "base", "base.txt")
	seed.Git("checkout", "-q", "-b", "feat/login", "main")
	commitAs("me@example.com", "login", "login.txt")
	seed.Git("checkout", "-q", "-b", "feat/x", "main")
	commitAs("sara@example.com", "x", "x.txt")
	seed.Git("checkout", "-q", "-b", "fork-main", "main")
	seed.Git("commit", "-q", "--allow-empty", "--author=Sara <sara@example.com>", "-m", "fork change")
	forkTip := seed.Git("rev-parse", "HEAD")
	seed.Git("checkout", "-q", "-b", "fork-spoof", "main")
	seed.Git("commit", "-q", "--allow-empty", "--author=Evil <me@example.com>", "-m", "spoofed author")
	seed.Git("push", "-q", base.Dir, "main", "feat/login", "feat/x", "fork-main:refs/pull/12/head", "fork-spoof:refs/pull/14/head")

	script := filepath.Join(app.Work, "ssh-standin.sh")
	body := fmt.Sprintf("#!/bin/sh\ncd %q && exec sh -c \"git ${2#git-}\"\n", hub)
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	clone := base.Clone(filepath.Join(app.Work, "api"))
	clone.Git("remote", "set-url", "origin", "git@github.com:acme/api.git")
	clone.Git("config", "ssh.variant", "simple")
	t.Setenv("GIT_SSH_COMMAND", script)
	clone.Git("config", "user.email", "me@example.com")

	write := func(name, content string) string {
		p := filepath.Join(app.Work, name)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	auth := fakeagent.GhRule{Match: "auth status", Emit: write("auth.txt", "github.com\n  Logged in to github.com account octocat (keyring)\n")}
	if authFail {
		auth = fakeagent.GhRule{Match: "auth status", Stderr: "You are not logged in to any GitHub hosts. Run gh auth login to authenticate.", Exit: 1}
	}
	app.Scenario(fakeagent.Scenario{
		Claude: map[string][]fakeagent.Action{"*": {{Name: "done"}}},
		Gh: []fakeagent.GhRule{
			{Match: "--version", Emit: write("version.txt", "gh version 2.42.0 (2024-01-08)\n")},
			auth,
			{Match: "api/pulls/11", Emit: write("p11.json", pullJSON(11, "Fix login", "feat/login", "acme", "me", ""))},
			{Match: "api/pulls/12", Emit: write("p12.json", pullJSON(12, "Fork change", "main", "forker", "sara", ""))},
			{Match: "api/pulls/14", Emit: write("p14.json", pullJSON(14, "Spoof", "main", "evil", "evil", ""))},
			{Match: "api/pulls/13", Emit: write("p13.json", pullJSON(13, "Old", "feat/old", "acme", "me", "2026-02-01T00:00:00Z"))},
			{Match: "api/pulls/99", Stderr: "gh: Not Found (HTTP 404)", Exit: 1},
			{Match: "/pulls?", Emit: write("empty.json", "[]")},
		},
	})
	rec := importRepo(t, app, clone.Dir)
	return &hostLinkFixture{app: app, repoID: rec.ID, forkTip: forkTip, clone: clone, authFail: authFail}
}

func (f *hostLinkFixture) resolve(t *testing.T, url string) (adewire.HostLinkTarget, error) {
	t.Helper()
	return f.app.W.AdeTask.ResolveHostLink(ctx, adewire.HostLinkArgs{URL: url})
}

func TestHostLink(t *testing.T) {
	f := newHostLinkFixture(t, false)
	app := f.app
	const pr11 = "https://github.com/acme/api/pull/11/files"

	// Contract ade-host-link: tests/ui/ade-v2-add-link.spec.ts reads these.
	args := adewire.HostLinkArgs{URL: pr11}
	app.Contract(t, "ade-host-link", "args:AdeTaskService.ResolveHostLink", args)
	got, err := app.W.AdeTask.ResolveHostLink(ctx, args)
	if err != nil {
		t.Fatal(err)
	}
	if got.CodeRepoID != f.repoID || got.Remote != "origin" || got.Branch != "feat/login" || got.Fork ||
		got.ChangeRequest == nil || got.ChangeRequest.Number != 11 || got.OnTaskID != "" {
		t.Fatalf("resolve PR 11 = %+v", got)
	}
	app.Contract(t, "ade-host-link", "AdeTaskService.ResolveHostLink#pr", got, flowharness.Mask("codeRepoId"))
	if _, err := f.clone.GitErr("rev-parse", "--verify", "-q", "refs/heads/feat/login"); err == nil {
		t.Fatal("resolve created a local branch")
	}

	fork, err := f.resolve(t, "https://github.com/acme/api/pull/12")
	if err != nil || !fork.Fork || fork.HeadOwner != "forker" || fork.Branch != "forker/main" || fork.Author != "sara" {
		t.Fatalf("resolve PR 12 = %+v, %v", fork, err)
	}
	app.Contract(t, "ade-host-link", "AdeTaskService.ResolveHostLink#fork", fork, flowharness.Mask("codeRepoId"))

	addArgs := adewire.HostLinkArgs{URL: "https://github.com/acme/api/pull/11"}
	app.Contract(t, "ade-host-link", "args:AdeTaskService.AddHostLink", addArgs)
	res, err := app.W.AdeTask.AddHostLink(ctx, addArgs)
	if err != nil {
		t.Fatal(err)
	}
	if res.Task.Kind != "task" || res.Task.Title != "Fix login" || res.Task.HostURL != "https://github.com/acme/api/pull/11" || res.Branch.Kind != "mine" {
		t.Fatalf("add PR 11 = task %+v branch kind %q", res.Task, res.Branch.Kind)
	}
	app.Contract(t, "ade-host-link", "AdeTaskService.AddHostLink#pr", res,
		flowharness.Mask("id", "createdAt", "branchIds", "codeRepoId", "taskId", "worktree", "tip", "base", "baseBranchId", "addedAt", "conflictCheck"))
	deadline := time.Now().Add(10 * time.Second)
	var br adewire.Branch
	for {
		br = branchOf(t, board(t, app), res.Task.ID, f.repoID)
		if br.Worktree != "" || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if fi, err := os.Stat(br.Worktree); err != nil || !fi.IsDir() {
		t.Fatalf("worktree %q: %v", br.Worktree, err)
	}

	again, err := f.resolve(t, pr11)
	if err != nil || again.OnTaskID != res.Task.ID {
		t.Fatalf("resolve after add = %+v, %v, want onTaskId %s", again, err, res.Task.ID)
	}
	if _, err := app.W.AdeTask.AddHostLink(ctx, addArgs); err == nil {
		t.Fatal("second add succeeded, want branch-on-task refusal")
	}

	review, err := app.W.AdeTask.AddHostLink(ctx, adewire.HostLinkArgs{URL: "https://github.com/acme/api/pull/12"})
	if err != nil {
		t.Fatal(err)
	}
	rb := branchOf(t, board(t, app), review.Task.ID, f.repoID)
	if review.Task.Kind != "review" || review.Task.Owner != "Sara" || rb.Kind != "review" || rb.Worktree != "" {
		t.Fatalf("fork add = task %q owner %q branch %q worktree %q", review.Task.Kind, review.Task.Owner, rb.Kind, rb.Worktree)
	}
	if tip := f.clone.Git("rev-parse", "forker/main"); tip != f.forkTip {
		t.Fatalf("forker/main = %s, want fork tip %s", tip, f.forkTip)
	}

	// A fork tip authored with the user's own email stays review and runs no prepare script.
	spoof, err := app.W.AdeTask.AddHostLink(ctx, adewire.HostLinkArgs{URL: "https://github.com/acme/api/pull/14"})
	if err != nil {
		t.Fatal(err)
	}
	sb := branchOf(t, board(t, app), spoof.Task.ID, f.repoID)
	if spoof.Task.Kind != "review" || sb.Kind != "review" || sb.Worktree != "" {
		t.Fatalf("spoofed fork add = task %q branch %q worktree %q, want review without worktree", spoof.Task.Kind, sb.Kind, sb.Worktree)
	}

	// A task holds one branch per repo, so the tree link joins a task with no repo yet.
	bare := createTask(t, app, "Manual", "")
	attached, err := app.W.AdeTask.AddHostLink(ctx, adewire.HostLinkArgs{URL: "https://github.com/acme/api/tree/feat/x/src/app", TaskID: bare.ID})
	if err != nil || attached.Task.ID != bare.ID || attached.Branch.Name != "feat/x" {
		t.Fatalf("tree add = %+v, %v, want feat/x on task %s", attached.Branch, err, bare.ID)
	}

	for url, want := range map[string]string{
		"https://github.com/acme/api/pull/13":   "already merged",
		"https://github.com/acme/api/pull/99":   "not found",
		"https://github.com/other/thing/pull/1": "No repo in your workspace",
		"https://github.com/acme/api/issues/5":  "names no branch",
		"https://example.com/acme/api/pull/1":   "paste a",
		"https://github.com/acme/api/tree/main": "main branch",
	} {
		if _, err := f.resolve(t, url); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("resolve %s: err %v, want %q", url, err, want)
		}
	}
}

func TestHostLinkUnauthenticated(t *testing.T) {
	f := newHostLinkFixture(t, true)
	if _, err := f.resolve(t, "https://github.com/acme/api/pull/11"); err == nil || !strings.Contains(err.Error(), "gh auth login") {
		t.Fatalf("resolve PR unauthenticated: %v, want gh auth login", err)
	}
	got, err := f.resolve(t, "https://github.com/acme/api/tree/feat/login")
	if err != nil || got.Branch != "feat/login" {
		t.Fatalf("resolve tree unauthenticated = %+v, %v", got, err)
	}
}
