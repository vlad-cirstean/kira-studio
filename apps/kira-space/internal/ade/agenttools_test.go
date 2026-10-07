package ade

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func toolErrText(t *testing.T, err error) string {
	t.Helper()
	var te adeagent.ToolError
	if !errors.As(err, &te) {
		t.Fatalf("err = %v; want an adeagent.ToolError", err)
	}
	return te.Error()
}

func TestSpaceTools_declareIsAdditiveAndIdempotent(t *testing.T) {
	e := newEngine(t, nil)
	e.repo("api")
	e.repo("web")
	e.workflow(flowYAML(agentStage("build", agentStep("first", ""))))
	id := e.task("api")
	ctx := context.Background()

	info, err := e.board.DeclareRepos(ctx, id, []string{"web", "api"})
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Repos) != 2 {
		t.Fatalf("repos = %+v; want api and web", info.Repos)
	}
	if _, err := e.board.DeclareRepos(ctx, id, []string{"web"}); err != nil {
		t.Fatalf("second declare: %v", err)
	}
	branches, _ := e.repos.AdeTasks.BranchesLive()
	var agent int
	for _, b := range branches {
		if b.TaskID == id && b.Origin == model.AdeBranchOriginAgent {
			agent++
		}
	}
	if agent != 1 {
		t.Fatalf("%d agent-origin branches; want 1 (web only)", agent)
	}
	_, err = e.board.DeclareRepos(ctx, id, []string{"nope"})
	if msg := toolErrText(t, err); !strings.Contains(msg, "Manage repositories") || !strings.Contains(msg, "api") {
		t.Fatalf("unknown repo message = %q", msg)
	}
}

func TestSpaceTools_requestBranch(t *testing.T) {
	e := newEngine(t, nil)
	e.repo("api")
	e.repo("web")
	e.prepare("api", "echo ok")
	e.workflow(flowYAML(agentStage("build", agentStep("first", ""))))
	id := e.task("api")
	other := e.task("web")
	ctx := context.Background()

	if _, err := e.board.RequestBranch(ctx, id, "web", "feat/x"); err == nil || !strings.Contains(toolErrText(t, err), "declare_repos") {
		t.Fatalf("branch in an undeclared repo: %v", err)
	}
	info, err := e.board.RequestBranch(ctx, id, "api", "feat/agent-login")
	if err != nil {
		t.Fatal(err)
	}
	if info.Branch != "feat/agent-login" || info.Worktree == "" || info.Setup.State == "none" {
		t.Fatalf("info = %+v", info)
	}
	sb := e.branch(t, id, "api")
	if sb.Origin != model.AdeBranchOriginAgent || sb.Name != "feat/agent-login" {
		t.Fatalf("stored branch = %+v", sb)
	}
	waitUntil(t, "setup ready", func() bool {
		s, _ := e.repos.AdeTasks.GetSetup(sb.ID)
		return s != nil && s.State == model.AdeSetupReady
	})

	again, err := e.board.RequestBranch(ctx, id, "api", "feat/agent-login")
	if err != nil || again.Worktree != info.Worktree {
		t.Fatalf("idempotent re-request: %+v, %v", again, err)
	}
	if _, err := e.board.RequestBranch(ctx, id, "api", "feat/other"); err == nil || !strings.Contains(toolErrText(t, err), "cannot be renamed") {
		t.Fatalf("rename of a created branch: %v", err)
	}
	if _, err := e.board.RequestBranch(ctx, other, "web", "feat/agent-login"); err != nil {
		t.Fatalf("same name in another repo: %v", err)
	}
}

func TestSpaceTools_requestBranchRefusals(t *testing.T) {
	e := newEngine(t, nil)
	e.repo("api")
	e.workflow(flowYAML(agentStage("build", agentStep("first", ""))))
	id := e.task("api")
	ctx := context.Background()
	main := e.board.mainShortName(ctx, "api")
	if main == "" {
		t.Fatal("no main branch")
	}
	for name, want := range map[string]string{
		main:                     "main branch",
		"bad name":               "not a valid",
		"-x":                     "not a valid",
		"a..b":                   "not a valid",
		"HEAD":                   "not a valid",
		strings.Repeat("a", 256): "longer than",
	} {
		_, err := e.board.RequestBranch(ctx, id, "api", name)
		if msg := toolErrText(t, err); !strings.Contains(msg, want) {
			t.Errorf("RequestBranch(%q) = %q; want %q", name, msg, want)
		}
	}
	if sb := e.branch(t, id, "api"); sb.Name != "" {
		t.Fatalf("a refused request left name %q", sb.Name)
	}

	if _, err := e.board.RequestBranch(ctx, id, "api", "feat/held"); err != nil {
		t.Fatal(err)
	}
	second := e.task("api")
	if _, err := e.board.RequestBranch(ctx, second, "api", "feat/held"); err == nil {
		t.Fatal("a name held by another task was accepted")
	} else if msg := toolErrText(t, err); !strings.Contains(msg, "already") {
		t.Fatalf("message = %q", msg)
	}
}

func TestSpaceTools_archivedAndBranchStatus(t *testing.T) {
	e := newEngine(t, nil)
	e.repo("api")
	gate := t.TempDir() + "/gate"
	e.prepare("api", "while [ ! -f "+gate+" ]; do sleep 0.05; done")
	e.workflow(flowYAML(agentStage("build", agentStep("first", ""))))
	id := e.task("api")
	ctx := context.Background()

	st, err := e.board.BranchStatus(ctx, id, "api", 0)
	if err != nil || st.Setup.State != "none" || st.Next == "" {
		t.Fatalf("status before branch = %+v, %v", st, err)
	}
	if _, err := e.board.RequestBranch(ctx, id, "api", "feat/slow"); err != nil {
		t.Fatal(err)
	}
	st, err = e.board.BranchStatus(ctx, id, "api", 0)
	if err != nil || st.Setup.State != model.AdeSetupRunning {
		t.Fatalf("status during setup = %+v, %v", st, err)
	}
	cctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	if _, err := e.board.BranchStatus(cctx, id, "api", time.Minute); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a cancelled wait returned %v", err)
	}
	if err := os.WriteFile(gate, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	st, err = e.board.BranchStatus(ctx, id, "api", 30*time.Second)
	if err != nil || st.Setup.State != model.AdeSetupReady {
		t.Fatalf("status after the wait = %+v, %v", st, err)
	}

	if err := e.board.ArchiveTask(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.board.TaskInfo(ctx, id); err == nil || !strings.Contains(toolErrText(t, err), "archived") {
		t.Fatalf("TaskInfo of an archived task: %v", err)
	}
	if _, err := e.board.RequestBranch(ctx, id, "api", "feat/late"); err == nil {
		t.Fatal("archived task accepted a branch")
	}
}

func (e *engine) branch(t *testing.T, taskID, repo string) model.AdeTaskBranch {
	t.Helper()
	sb, err := e.repos.AdeTasks.GetBranch(branchOf(t, e, taskID, repo))
	if err != nil {
		t.Fatal(err)
	}
	return sb
}

func TestSpaceTools_startRunCreatesNoBranch(t *testing.T) {
	e := newEngine(t, map[string][]string{"*": {"done"}})
	e.repo("api")
	e.workflow("id: flow\nname: Flow\nkira_space_mcp: true\nstages:\n" + agentStage("build", agentStep("first", "")))
	id := e.task("api")
	e.start(id)
	e.waitRun(id, "first/api", model.AdeRunDone)
	if sb := e.branch(t, id, "api"); sb.Name != "" {
		t.Fatalf("StartRun created branch %q; want none", sb.Name)
	}
	info, err := e.board.RequestBranch(context.Background(), id, "api", "feat/mine")
	if err != nil || info.Branch != "feat/mine" {
		t.Fatalf("request_branch after start: %+v, %v", info, err)
	}
}
