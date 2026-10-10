package ade

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
)

// maxBranchNameBytes is git's ref name limit on common file systems.
const maxBranchNameBytes = 255

// maxScriptRunScan bounds the script runs run_outcome reads before filtering.
const maxScriptRunScan = 50

// toolErr turns a caller mistake into text the agent can act on; anything else passes through.
func toolErr(err error) error {
	switch {
	case errors.Is(err, ErrInvalidInput):
		return claudeheadless.ToolError(strings.TrimPrefix(err.Error(), ErrInvalidInput.Error()+": "))
	case errors.Is(err, repos.ErrTaskNotFound):
		return claudeheadless.ToolError("The task no longer exists.")
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
		return claudeheadless.ToolError("This is a review task. Branches cannot be declared or created on it.")
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
				return "", claudeheadless.ToolError(fmt.Sprintf("%q matches several repos. Use a code repo id: %s.", ref, strings.Join(ids, ", ")))
			}
		}
	}
	names := make([]string, len(cands))
	for i, c := range cands {
		names[i] = cmpNonEmpty(c.nickname, c.name)
	}
	if kind == "registered" {
		return "", claudeheadless.ToolError(fmt.Sprintf("Repo %q is not registered in Kira Space. Registered: %s. Ask the user to import it from Git > Manage repositories, then try again.",
			ref, joinOrNone(names)))
	}
	return "", claudeheadless.ToolError(fmt.Sprintf("Repo %q is not on this task. On the task: %s. Call declare_repos first.", ref, joinOrNone(names)))
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

func (b *TaskBoard) setupInfo(sb model.AdeTaskBranch, worktree string) claudeheadless.SetupInfo {
	row, err := b.deps.Tasks.GetSetup(sb.ID)
	if err != nil || row == nil {
		if worktree != "" {
			return claudeheadless.SetupInfo{State: "ready"}
		}
		return claudeheadless.SetupInfo{State: "none"}
	}
	return claudeheadless.SetupInfo{State: row.State, Note: row.Note}
}

// worktreePath is worktreeOf with a lookup failure read as "no worktree".
func (b *TaskBoard) worktreePath(ctx context.Context, sb model.AdeTaskBranch) string {
	path, _ := b.worktreeOf(ctx, sb)
	return path
}

func (b *TaskBoard) spaceInfo(ctx context.Context, tc *taskCtx) (claudeheadless.TaskInfo, error) {
	_, cfgs, err := b.registeredCandidates()
	if err != nil {
		return claudeheadless.TaskInfo{}, err
	}
	info := claudeheadless.TaskInfo{
		Title:      taskTitle(tc.task, tc.branches),
		JiraKey:    tc.task.JiraKey,
		Stage:      "",
		Repos:      []claudeheadless.TaskRepo{},
		Registered: make([]claudeheadless.RegisteredRepo, 0, len(cfgs)),
	}
	if tc.stage != nil {
		info.Stage = tc.stage.Name
	}
	if wf, ok := b.taskWorkflow(tc.task); ok {
		info.Workflow = wf.Name
	}
	for _, br := range tc.branches {
		r := claudeheadless.TaskRepo{Repo: tc.nick[br.CodeRepoID], CodeRepoID: br.CodeRepoID}
		if br.Name != "" {
			name := br.Name
			r.Branch = &name
			r.Worktree = b.worktreePath(ctx, br)
		}
		r.Setup = b.setupInfo(br, r.Worktree)
		info.Repos = append(info.Repos, r)
	}
	for _, c := range cfgs {
		info.Registered = append(info.Registered, claudeheadless.RegisteredRepo{Name: c.Name, Nickname: c.Nickname, CodeRepoID: c.CodeRepoID, Path: c.Root})
	}
	return info, nil
}

// TaskInfo implements claudeheadless.SpaceTools.
func (b *TaskBoard) TaskInfo(ctx context.Context, taskID string) (claudeheadless.TaskInfo, error) {
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return claudeheadless.TaskInfo{}, err
	}
	return b.spaceInfo(ctx, tc)
}

// DeclareRepos implements claudeheadless.SpaceTools: it only adds not-created branches in registered
// repos, never removes one, and ignores a repo the task already has.
func (b *TaskBoard) DeclareRepos(ctx context.Context, taskID string, refs []string) (claudeheadless.TaskInfo, error) {
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return claudeheadless.TaskInfo{}, err
	}
	if err := b.spaceWritable(tc); err != nil {
		return claudeheadless.TaskInfo{}, err
	}
	cands, _, err := b.registeredCandidates()
	if err != nil {
		return claudeheadless.TaskInfo{}, err
	}
	ids := make([]string, 0, len(refs))
	for _, ref := range refs {
		id, err := resolveRepoRef(ref, cands, "registered")
		if err != nil {
			return claudeheadless.TaskInfo{}, err
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
			return claudeheadless.TaskInfo{}, toolErr(err)
		}
		added = true
	}
	if added {
		b.notifyBoard()
	}
	tc, err = b.spaceCtx(taskID)
	if err != nil {
		return claudeheadless.TaskInfo{}, err
	}
	return b.spaceInfo(ctx, tc)
}

// validateAgentBranch refuses a name git rejects and the names an agent must never take.
func (b *TaskBoard) validateAgentBranch(ctx context.Context, rec model.CodeRepo, name string) error {
	switch {
	case name == "" || strings.TrimSpace(name) != name:
		return claudeheadless.ToolError("The branch name is empty or has leading or trailing spaces.")
	case len(name) > maxBranchNameBytes:
		return claudeheadless.ToolError(fmt.Sprintf("The branch name is longer than %d bytes.", maxBranchNameBytes))
	case strings.HasPrefix(name, "-") || strings.Contains(name, "@{") || name == "HEAD":
		return claudeheadless.ToolError(fmt.Sprintf("%q is not a valid branch name.", name))
	}
	cmd := exec.CommandContext(ctx, "git", "check-ref-format", "--branch", name)
	cmd.Dir = rec.Root
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return claudeheadless.ToolError(fmt.Sprintf("%q is not a valid git branch name.", name))
		}
		return fmt.Errorf("ade: check branch name: %w", err)
	}
	if main := b.mainShortName(ctx, rec.ID); main != "" && name == main {
		return claudeheadless.ToolError(fmt.Sprintf("%q is the repo's main branch. Pick a new feature branch name.", name))
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
				return claudeheadless.ToolError(fmt.Sprintf("%q is an integration branch of the repo. Pick a new feature branch name.", name))
			}
		}
	}
	return nil
}

// RequestBranch implements claudeheadless.SpaceTools: it creates the branch and its worktree, or confirms
// the one the task already has under that name.
func (b *TaskBoard) RequestBranch(ctx context.Context, taskID, ref, name string) (claudeheadless.BranchInfo, error) {
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return claudeheadless.BranchInfo{}, err
	}
	if err := b.spaceWritable(tc); err != nil {
		return claudeheadless.BranchInfo{}, err
	}
	_, cfgs, err := b.registeredCandidates()
	if err != nil {
		return claudeheadless.BranchInfo{}, err
	}
	id, err := resolveRepoRef(ref, b.taskCandidates(tc, cfgs), "task")
	if err != nil {
		return claudeheadless.BranchInfo{}, err
	}
	var sb model.AdeTaskBranch
	for _, br := range tc.branches {
		if br.CodeRepoID == id {
			sb = br
		}
	}
	nick := tc.nick[id]
	if sb.Kind != model.AdeBranchKindMine {
		return claudeheadless.BranchInfo{}, claudeheadless.ToolError(fmt.Sprintf("The branch of %s on this task is not yours to create.", nick))
	}
	if sb.Name != "" && sb.Name != name {
		return claudeheadless.BranchInfo{}, claudeheadless.ToolError(fmt.Sprintf("%s already has branch %q on this task. Branches cannot be renamed; use that one.", nick, sb.Name))
	}
	rec, err := b.deps.CodeRepos.Get(id)
	if err != nil {
		return claudeheadless.BranchInfo{}, err
	}
	if rec == nil {
		return claudeheadless.BranchInfo{}, claudeheadless.ToolError(fmt.Sprintf("Repo %s is no longer registered.", nick))
	}
	fresh := sb.Name == ""
	if fresh {
		if err := b.validateAgentBranch(ctx, *rec, name); err != nil {
			return claudeheadless.BranchInfo{}, err
		}
	}
	res, err := b.ensureWorktree(ctx, taskTitle(tc.task, tc.branches), *rec, sb, name)
	if err != nil {
		return claudeheadless.BranchInfo{}, toolErr(err)
	}
	if fresh {
		if err := b.deps.Tasks.SetBranchOrigin(sb.ID, model.AdeBranchOriginAgent); err != nil {
			return claudeheadless.BranchInfo{}, err
		}
		sb.Name = res.Name
	}
	if res.Fresh {
		if err := b.startSetup(*rec, sb, res.Name, res.Path, b.onSetupReady); err != nil {
			return claudeheadless.BranchInfo{}, err
		}
	}
	b.notifyBoard()
	return b.branchInfo(sb, nick, res.Path), nil
}

func (b *TaskBoard) branchInfo(sb model.AdeTaskBranch, nick, worktree string) claudeheadless.BranchInfo {
	info := claudeheadless.BranchInfo{Repo: nick, Branch: sb.Name, Worktree: worktree, Setup: b.setupInfo(sb, worktree)}
	switch info.Setup.State {
	case model.AdeSetupRunning:
		info.Next = "The worktree is still preparing. Call branch_status with waitSeconds, then edit in " + worktree + "."
	case model.AdeSetupFailed:
		info.Next = "The worktree setup failed. Tell the user; do not edit until it is fixed."
		if info.Setup.Note != "" {
			info.Next += " Reason: " + info.Setup.Note
		}
	default:
		info.Next = "Ready. Work in " + worktree + "."
	}
	return info
}

// BranchStatus implements claudeheadless.SpaceTools: the state of the repo's worktree, waiting up to wait
// for a running setup to finish.
func (b *TaskBoard) BranchStatus(ctx context.Context, taskID, ref string, wait time.Duration) (claudeheadless.BranchInfo, error) {
	br, nick, early, err := b.taskBranch(taskID, ref)
	if err != nil {
		return claudeheadless.BranchInfo{}, err
	}
	if early != nil {
		return *early, nil
	}
	deadline := time.Now().Add(wait)
	for b.setupRunning(br) && time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return b.branchInfo(br, nick, b.worktreePath(ctx, br)), ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return b.branchInfo(br, nick, b.worktreePath(ctx, br)), nil
}

func (b *TaskBoard) setupRunning(sb model.AdeTaskBranch) bool {
	row, err := b.deps.Tasks.GetSetup(sb.ID)
	return err == nil && row != nil && row.State == model.AdeSetupRunning
}

// taskBranch resolves ref to the task's branch row; early answers a repo with no branch yet.
func (b *TaskBoard) taskBranch(taskID, ref string) (br model.AdeTaskBranch, nick string, early *claudeheadless.BranchInfo, err error) {
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return br, "", nil, err
	}
	_, cfgs, err := b.registeredCandidates()
	if err != nil {
		return br, "", nil, err
	}
	id, err := resolveRepoRef(ref, b.taskCandidates(tc, cfgs), "task")
	if err != nil {
		return br, "", nil, err
	}
	for _, br := range tc.branches {
		if br.CodeRepoID != id {
			continue
		}
		if br.Name == "" {
			return br, "", &claudeheadless.BranchInfo{Repo: tc.nick[id], Setup: claudeheadless.SetupInfo{State: "none"},
				Next: "No branch yet. Call request_branch."}, nil
		}
		return br, tc.nick[id], nil, nil
	}
	return br, "", nil, claudeheadless.ToolError("Repo is not on this task.")
}

// RunOutcomes is the run_outcome tool's read: the task's runs, newest first, filtered by q.
func (b *TaskBoard) RunOutcomes(_ context.Context, taskID string, q claudeheadless.OutcomeQuery) ([]claudeheadless.RunOutcomeEntry, error) {
	tc, err := b.spaceCtx(taskID)
	if err != nil {
		return nil, err
	}
	if q.Kind == "automation" {
		return b.automationOutcomes(taskID, q)
	}
	runs, err := b.deps.Tasks.RunsOfTask(taskID)
	if err != nil {
		return nil, err
	}
	out := []claudeheadless.RunOutcomeEntry{}
	for i := len(runs) - 1; i >= 0 && len(out) < q.Limit; i-- {
		r := runs[i]
		kind := "step"
		if r.Purpose == model.AdeRunPurposeRebase {
			kind = "rebase"
		}
		if q.RunID != "" && r.ID != q.RunID || q.Kind != "" && q.Kind != kind {
			continue
		}
		br, _ := tc.branch(r.BranchID)
		if q.Branch != "" && br.Name != q.Branch {
			continue
		}
		entry := claudeheadless.RunOutcomeEntry{
			RunID: r.ID, Kind: kind, Stage: r.StageID, Step: r.StepID, Repo: tc.nick[br.CodeRepoID], Branch: br.Name,
			State: r.State, FinishedAt: r.FinishedAt,
		}
		if r.Outcome != nil {
			entry.Outcome = r.Outcome
		}
		out = append(out, entry)
	}
	return out, nil
}

// automationOutcomes lists the task's script runs, newest first, for run_outcome kind automation.
func (b *TaskBoard) automationOutcomes(taskID string, q claudeheadless.OutcomeQuery) ([]claudeheadless.RunOutcomeEntry, error) {
	out := []claudeheadless.RunOutcomeEntry{}
	if b.deps.ScriptRunsOf == nil {
		return out, nil
	}
	runs, err := b.deps.ScriptRunsOf(taskID, maxScriptRunScan)
	if err != nil {
		return nil, err
	}
	for _, r := range runs {
		if len(out) >= q.Limit {
			break
		}
		if q.RunID != "" && r.ID != q.RunID {
			continue
		}
		repo, branch, _ := strings.Cut(r.BranchLabel, " · ")
		if q.Branch != "" && branch != q.Branch {
			continue
		}
		entry := claudeheadless.RunOutcomeEntry{
			RunID: r.ID, Kind: "automation", Step: r.ScriptName, Repo: repo, Branch: branch, State: r.State, FinishedAt: r.FinishedAt,
		}
		if r.Outcome != nil {
			entry.Outcome = r.Outcome
		}
		out = append(out, entry)
	}
	return out, nil
}
