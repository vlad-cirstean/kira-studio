package ade

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// maxBranchNameBytes is git's ref name limit on common file systems.
const maxBranchNameBytes = 255

// toolErr turns a caller mistake into text the agent can act on; anything else passes through.
func toolErr(err error) error {
	switch {
	case errors.Is(err, ErrInvalidInput):
		return adeagent.ToolError(strings.TrimPrefix(err.Error(), ErrInvalidInput.Error()+": "))
	case errors.Is(err, repos.ErrTaskNotFound):
		return adeagent.ToolError("The task no longer exists.")
	}
	return err
}

// spaceCtx loads a task an agent may act on: live and not a review task.
func (b *TaskBoard) spaceCtx(taskID string) (*taskCtx, error) {
	tc, err := b.loadTaskCtx(taskID)
	if err != nil {
		return nil, toolErr(err)
	}
	if err := b.checkNotArchiving(taskID); err != nil {
		return nil, toolErr(err)
	}
	return tc, nil
}

func (b *TaskBoard) spaceWritable(tc *taskCtx) error {
	if tc.task.Kind == model.AdeTaskKindReview {
		return adeagent.ToolError("This is a review task. Branches cannot be declared or created on it.")
	}
	return nil
}

type repoCandidate struct{ id, name, nickname string }

// resolveRepoRef matches a nickname, then a name, then a code repo id, exactly. A tier with several
// matches is ambiguous and never falls through to the next.
func resolveRepoRef(ref string, cands []repoCandidate, kind string) (string, error) {
	ref = strings.TrimSpace(ref)
	tiers := []func(repoCandidate) string{
		func(c repoCandidate) string { return c.nickname },
		func(c repoCandidate) string { return c.name },
		func(c repoCandidate) string { return c.id },
	}
	if ref != "" {
		for _, key := range tiers {
			var hits []repoCandidate
			for _, c := range cands {
				if key(c) == ref {
					hits = append(hits, c)
				}
			}
			switch len(hits) {
			case 0:
			case 1:
				return hits[0].id, nil
			default:
				ids := make([]string, len(hits))
				for i, h := range hits {
					ids[i] = h.id
				}
				return "", adeagent.ToolError(fmt.Sprintf("%q matches several repos. Use a code repo id: %s.", ref, strings.Join(ids, ", ")))
			}
		}
	}
	names := make([]string, len(cands))
	for i, c := range cands {
		names[i] = cmpNonEmpty(c.nickname, c.name)
	}
	if kind == "registered" {
		return "", adeagent.ToolError(fmt.Sprintf("Repo %q is not registered in Kira Space. Registered: %s. Ask the user to import it from Git > Manage repositories, then try again.",
			ref, joinOrNone(names)))
	}
	return "", adeagent.ToolError(fmt.Sprintf("Repo %q is not on this task. On the task: %s. Call declare_repos first.", ref, joinOrNone(names)))
}

func joinOrNone(s []string) string {
	if len(s) == 0 {
		return "none"
	}
	return strings.Join(s, ", ")
}

func (b *TaskBoard) registeredCandidates() ([]repoCandidate, []model.AdeRepoConfig, error) {
	cfgs, err := b.deps.RepoConfig.List()
	if err != nil {
		return nil, nil, err
	}
	out := make([]repoCandidate, len(cfgs))
	for i, c := range cfgs {
		out[i] = repoCandidate{id: c.CodeRepoID, name: c.Name, nickname: c.Nickname}
	}
	return out, cfgs, nil
}

func (b *TaskBoard) taskCandidates(tc *taskCtx, cfgs []model.AdeRepoConfig) []repoCandidate {
	byID := make(map[string]model.AdeRepoConfig, len(cfgs))
	for _, c := range cfgs {
		byID[c.CodeRepoID] = c
	}
	out := make([]repoCandidate, 0, len(tc.branches))
	for _, br := range tc.branches {
		c := byID[br.CodeRepoID]
		out = append(out, repoCandidate{id: br.CodeRepoID, name: c.Name, nickname: c.Nickname})
	}
	return out
}

func (b *TaskBoard) setupInfo(sb model.AdeTaskBranch, worktree string) adeagent.SetupInfo {
	row, err := b.deps.Tasks.GetSetup(sb.ID)
	if err != nil || row == nil {
		if worktree != "" {
			return adeagent.SetupInfo{State: "ready"}
		}
		return adeagent.SetupInfo{State: "none"}
	}
	return adeagent.SetupInfo{State: row.State}
}

// worktreePath is worktreeOf with a lookup failure read as "no worktree".
func (b *TaskBoard) worktreePath(ctx context.Context, sb model.AdeTaskBranch) string {
	path, _ := b.worktreeOf(ctx, sb)
	return path
}

func (b *TaskBoard) spaceInfo(ctx context.Context, tc *taskCtx) (adeagent.TaskInfo, error) {
	_, cfgs, err := b.registeredCandidates()
	if err != nil {
		return adeagent.TaskInfo{}, err
	}
	info := adeagent.TaskInfo{
		Title:      taskTitle(tc.task, tc.branches),
		JiraKey:    tc.task.JiraKey,
		Stage:      "",
		Repos:      []adeagent.TaskRepo{},
		Registered: make([]adeagent.RegisteredRepo, 0, len(cfgs)),
	}
	if tc.stage != nil {
		info.Stage = tc.stage.Name
	}
	if wf, ok := b.taskWorkflow(tc.task); ok {
		info.Workflow = wf.Name
	}
	for _, br := range tc.branches {
		r := adeagent.TaskRepo{Repo: tc.nick[br.CodeRepoID], CodeRepoID: br.CodeRepoID}
		if br.Name != "" {
			name := br.Name
			r.Branch = &name
			r.Worktree = b.worktreePath(ctx, br)
		}
		r.Setup = b.setupInfo(br, r.Worktree)
		info.Repos = append(info.Repos, r)
	}
	for _, c := range cfgs {
		info.Registered = append(info.Registered, adeagent.RegisteredRepo{Name: c.Name, Nickname: c.Nickname, CodeRepoID: c.CodeRepoID, Path: c.Root})
	}
	return info, nil
}

// TaskInfo implements adeagent.SpaceTools.
func (b *TaskBoard) TaskInfo(ctx context.Context, taskID string) (adeagent.TaskInfo, error) {
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return adeagent.TaskInfo{}, err
	}
	return b.spaceInfo(ctx, tc)
}

// DeclareRepos implements adeagent.SpaceTools: it only adds not-created branches in registered
// repos, never removes one, and ignores a repo the task already has.
func (b *TaskBoard) DeclareRepos(ctx context.Context, taskID string, refs []string) (adeagent.TaskInfo, error) {
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return adeagent.TaskInfo{}, err
	}
	if err := b.spaceWritable(tc); err != nil {
		return adeagent.TaskInfo{}, err
	}
	cands, _, err := b.registeredCandidates()
	if err != nil {
		return adeagent.TaskInfo{}, err
	}
	ids := make([]string, 0, len(refs))
	for _, ref := range refs {
		id, err := resolveRepoRef(ref, cands, "registered")
		if err != nil {
			return adeagent.TaskInfo{}, err
		}
		ids = append(ids, id)
	}
	on := map[string]bool{}
	for _, br := range tc.branches {
		on[br.CodeRepoID] = true
	}
	added := false
	for _, id := range ids {
		if on[id] {
			continue
		}
		on[id] = true
		if _, err := b.deps.Tasks.AddBranch(model.AdeTaskBranch{
			ID: b.newID(), TaskID: taskID, CodeRepoID: id, Kind: model.AdeBranchKindMine,
			AddedAt: b.deps.Now().UnixMilli(), Origin: model.AdeBranchOriginAgent,
		}); err != nil {
			return adeagent.TaskInfo{}, toolErr(err)
		}
		added = true
	}
	if added {
		b.notifyBoard()
	}
	tc, err = b.spaceCtx(taskID)
	if err != nil {
		return adeagent.TaskInfo{}, err
	}
	return b.spaceInfo(ctx, tc)
}

// validateAgentBranch refuses a name git rejects and the names an agent must never take.
func (b *TaskBoard) validateAgentBranch(ctx context.Context, rec model.CodeRepo, name string) error {
	switch {
	case name == "" || strings.TrimSpace(name) != name:
		return adeagent.ToolError("The branch name is empty or has leading or trailing spaces.")
	case len(name) > maxBranchNameBytes:
		return adeagent.ToolError(fmt.Sprintf("The branch name is longer than %d bytes.", maxBranchNameBytes))
	case strings.HasPrefix(name, "-") || strings.Contains(name, "@{") || name == "HEAD":
		return adeagent.ToolError(fmt.Sprintf("%q is not a valid branch name.", name))
	}
	cmd := exec.CommandContext(ctx, "git", "check-ref-format", "--branch", name)
	cmd.Dir = rec.Root
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return adeagent.ToolError(fmt.Sprintf("%q is not a valid git branch name.", name))
		}
		return fmt.Errorf("ade: check branch name: %w", err)
	}
	if main := b.mainShortName(ctx, rec.ID); main != "" && name == main {
		return adeagent.ToolError(fmt.Sprintf("%q is the repo's main branch. Pick a new feature branch name.", name))
	}
	cfgs, err := b.deps.RepoConfig.List()
	if err != nil {
		return err
	}
	for _, c := range cfgs {
		if c.CodeRepoID != rec.ID {
			continue
		}
		for _, t := range c.IntegrationBranches {
			if t == name {
				return adeagent.ToolError(fmt.Sprintf("%q is an integration branch of the repo. Pick a new feature branch name.", name))
			}
		}
	}
	return nil
}

// RequestBranch implements adeagent.SpaceTools: it creates the branch and its worktree, or confirms
// the one the task already has under that name.
func (b *TaskBoard) RequestBranch(ctx context.Context, taskID, ref, name string) (adeagent.BranchInfo, error) {
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return adeagent.BranchInfo{}, err
	}
	if err := b.spaceWritable(tc); err != nil {
		return adeagent.BranchInfo{}, err
	}
	_, cfgs, err := b.registeredCandidates()
	if err != nil {
		return adeagent.BranchInfo{}, err
	}
	id, err := resolveRepoRef(ref, b.taskCandidates(tc, cfgs), "task")
	if err != nil {
		return adeagent.BranchInfo{}, err
	}
	var sb model.AdeTaskBranch
	for _, br := range tc.branches {
		if br.CodeRepoID == id {
			sb = br
		}
	}
	nick := tc.nick[id]
	if sb.Kind != model.AdeBranchKindMine {
		return adeagent.BranchInfo{}, adeagent.ToolError(fmt.Sprintf("The branch of %s on this task is not yours to create.", nick))
	}
	if sb.Name != "" && sb.Name != name {
		return adeagent.BranchInfo{}, adeagent.ToolError(fmt.Sprintf("%s already has branch %q on this task. Branches cannot be renamed; use that one.", nick, sb.Name))
	}
	rec, err := b.deps.CodeRepos.Get(id)
	if err != nil {
		return adeagent.BranchInfo{}, err
	}
	if rec == nil {
		return adeagent.BranchInfo{}, adeagent.ToolError(fmt.Sprintf("Repo %s is no longer registered.", nick))
	}
	fresh := sb.Name == ""
	if fresh {
		if err := b.validateAgentBranch(ctx, *rec, name); err != nil {
			return adeagent.BranchInfo{}, err
		}
	}
	res, err := b.ensureWorktree(ctx, taskTitle(tc.task, tc.branches), *rec, sb, name)
	if err != nil {
		return adeagent.BranchInfo{}, toolErr(err)
	}
	if fresh {
		if err := b.deps.Tasks.SetBranchOrigin(sb.ID, model.AdeBranchOriginAgent); err != nil {
			return adeagent.BranchInfo{}, err
		}
		sb.Name = res.Name
	}
	if res.Fresh {
		if err := b.startSetup(*rec, sb, res.Name, res.Path, b.onSetupReady); err != nil {
			return adeagent.BranchInfo{}, err
		}
	}
	b.notifyBoard()
	return b.branchInfo(sb, nick, res.Path), nil
}

func (b *TaskBoard) branchInfo(sb model.AdeTaskBranch, nick, worktree string) adeagent.BranchInfo {
	info := adeagent.BranchInfo{Repo: nick, Branch: sb.Name, Worktree: worktree, Setup: b.setupInfo(sb, worktree)}
	switch info.Setup.State {
	case model.AdeSetupRunning:
		info.Next = "The worktree is still preparing. Call branch_status with waitSeconds, then edit in " + worktree + "."
	case model.AdeSetupFailed:
		info.Next = "The worktree setup failed. Tell the user; do not edit until it is fixed."
	default:
		info.Next = "Ready. Work in " + worktree + "."
	}
	return info
}

// BranchStatus implements adeagent.SpaceTools: the state of the repo's worktree, waiting up to wait
// for a running setup to finish.
func (b *TaskBoard) BranchStatus(ctx context.Context, taskID, ref string, wait time.Duration) (adeagent.BranchInfo, error) {
	deadline := time.Now().Add(wait)
	for {
		info, running, err := b.branchStatusOnce(ctx, taskID, ref)
		if err != nil || !running || !time.Now().Before(deadline) {
			return info, err
		}
		select {
		case <-ctx.Done():
			return info, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (b *TaskBoard) branchStatusOnce(ctx context.Context, taskID, ref string) (adeagent.BranchInfo, bool, error) {
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return adeagent.BranchInfo{}, false, err
	}
	_, cfgs, err := b.registeredCandidates()
	if err != nil {
		return adeagent.BranchInfo{}, false, err
	}
	id, err := resolveRepoRef(ref, b.taskCandidates(tc, cfgs), "task")
	if err != nil {
		return adeagent.BranchInfo{}, false, err
	}
	for _, br := range tc.branches {
		if br.CodeRepoID != id {
			continue
		}
		if br.Name == "" {
			return adeagent.BranchInfo{Repo: tc.nick[id], Setup: adeagent.SetupInfo{State: "none"},
				Next: "No branch yet. Call request_branch."}, false, nil
		}
		wt := b.worktreePath(ctx, br)
		info := b.branchInfo(br, tc.nick[id], wt)
		return info, info.Setup.State == model.AdeSetupRunning, nil
	}
	return adeagent.BranchInfo{}, false, adeagent.ToolError("Repo is not on this task.")
}
