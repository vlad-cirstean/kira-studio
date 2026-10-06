package ade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// ErrInvalidInput marks a caller mistake (bad id, bad value); the bridge maps it to E_INVALID.
var ErrInvalidInput = errors.New("ade: invalid input")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(format, args...))
}

func (b *TaskBoard) newID() string { return uuid.NewString() }

// --- helpers -----------------------------------------------------------------------------------

func (b *TaskBoard) wireTask(t model.AdeTask) (adewire.Task, error) {
	branches, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return adewire.Task{}, err
	}
	var ids []string
	for _, br := range branches {
		if br.TaskID == t.ID {
			ids = append(ids, br.ID)
		}
	}
	runs, err := b.deps.Tasks.RunsOfTask(t.ID)
	if err != nil {
		return adewire.Task{}, err
	}
	return toWireTask(t, ids, runs), nil
}

// stageSnapshot is the JSON of a workflow's first stage, the task's currentStage on creation.
func stageSnapshot(wf adewire.Workflow) (stageID, stageJSON string, err error) {
	if len(wf.Stages) == 0 {
		return "", "", nil
	}
	raw, err := json.Marshal(wf.Stages[0])
	if err != nil {
		return "", "", err
	}
	return wf.Stages[0].ID, string(raw), nil
}

func (b *TaskBoard) requireRepos(ids []string) error {
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			return invalid("codeRepoIds must be distinct, non-empty ids")
		}
		seen[id] = true
		rec, err := b.deps.CodeRepos.Get(id)
		if err != nil {
			return err
		}
		if rec == nil {
			return invalid("code repo %s not found", id)
		}
	}
	return nil
}

// mainShortName is the repo's main branch short name, "" when it cannot be read.
func (b *TaskBoard) mainShortName(ctx context.Context, codeRepoID string) string {
	entry, err := b.openRepo(ctx, codeRepoID)
	if err != nil {
		return ""
	}
	name, _, ok, err := entry.MainRef(ctx)
	if err != nil || !ok {
		return ""
	}
	short, _ := mainDisplay(name)
	return short
}

func jiraFields(j *adewire.Jira) (key, url string) {
	if j == nil {
		return "", ""
	}
	return j.Key, j.URL
}

// --- tasks -------------------------------------------------------------------------------------

// CreateTask creates a task with one not-created branch per repo, appended to the plan as Later.
func (b *TaskBoard) CreateTask(_ context.Context, args adewire.CreateTaskArgs) (adewire.Task, error) {
	jiraKey, jiraURL := jiraFields(args.Jira)
	title := strings.TrimSpace(args.Title)
	if title == "" && jiraKey == "" {
		return adewire.Task{}, invalid("a task needs a title or a Jira key")
	}
	if len(args.CodeRepoIDs) == 0 {
		return adewire.Task{}, invalid("a task needs at least one repo")
	}
	if err := b.requireRepos(args.CodeRepoIDs); err != nil {
		return adewire.Task{}, err
	}
	task := model.AdeTask{
		ID: b.newID(), Kind: model.AdeTaskKindTask, Title: title, JiraKey: jiraKey, JiraURL: jiraURL,
		GithubURL: args.GithubURL, Notes: args.Notes, CreatedAt: b.deps.Now().UnixMilli(),
	}
	if args.WorkflowID != "" {
		if b.deps.Workflows == nil {
			return adewire.Task{}, invalid("workflow %q not found", args.WorkflowID)
		}
		wf, ok := b.deps.Workflows.Get(args.WorkflowID)
		if !ok {
			return adewire.Task{}, invalid("workflow %q not found", args.WorkflowID)
		}
		var err error
		task.WorkflowID = wf.ID
		if task.StageID, task.CurrentStageJSON, err = stageSnapshot(wf); err != nil {
			return adewire.Task{}, err
		}
	}
	branches := make([]model.AdeTaskBranch, len(args.CodeRepoIDs))
	for i, repoID := range args.CodeRepoIDs {
		branches[i] = model.AdeTaskBranch{
			ID: b.newID(), TaskID: task.ID, CodeRepoID: repoID, Kind: model.AdeBranchKindMine,
			Position: i, AddedAt: task.CreatedAt,
		}
	}
	stored, err := b.deps.Tasks.CreateTask(task, branches)
	if err != nil {
		return adewire.Task{}, err
	}
	b.notifyBoard()
	return b.wireTask(stored)
}

// UpdateTask applies a patch; the estimate may only grow, kind moves only between task and parked.
func (b *TaskBoard) UpdateTask(_ context.Context, args adewire.UpdateTaskArgs) (adewire.Task, error) {
	p := args.Patch
	if p.Jira != nil && p.ClearJira {
		return adewire.Task{}, invalid("jira and clearJira are mutually exclusive")
	}
	patch := model.AdeTaskPatch{Title: p.Title, GithubURL: p.GithubURL, Est: p.Est, Notes: p.Notes, Color: p.Color, Kind: p.Kind}
	if p.Title != nil {
		trimmed := strings.TrimSpace(*p.Title)
		patch.Title = &trimmed
	}
	switch {
	case p.Jira != nil:
		patch.JiraKey, patch.JiraURL = &p.Jira.Key, &p.Jira.URL
	case p.ClearJira:
		empty := ""
		patch.JiraKey, patch.JiraURL = &empty, &empty
	}
	task, err := b.deps.Tasks.UpdateTask(args.TaskID, patch)
	if err != nil {
		return adewire.Task{}, err
	}
	b.notifyBoard()
	return b.wireTask(task)
}

// AddTaskRepo adds a not-created branch in another repo to a live task.
func (b *TaskBoard) AddTaskRepo(ctx context.Context, args adewire.AddTaskRepoArgs) (adewire.Branch, error) {
	if err := b.requireRepos([]string{args.CodeRepoID}); err != nil {
		return adewire.Branch{}, err
	}
	sb, err := b.deps.Tasks.AddBranch(model.AdeTaskBranch{
		ID: b.newID(), TaskID: args.TaskID, CodeRepoID: args.CodeRepoID, Kind: model.AdeBranchKindMine,
		AddedAt: b.deps.Now().UnixMilli(),
	})
	if err != nil {
		return adewire.Branch{}, err
	}
	b.notifyBoard()
	return zeroBranch(sb, b.mainShortName(ctx, sb.CodeRepoID), nil), nil
}

// CandidateBranches lists, per code repo, local and remote-only branches that are not on a live
// task and not the repo's main, newest commit first.
func (b *TaskBoard) CandidateBranches(ctx context.Context) (adewire.CandidateBranchesResult, error) {
	repoList, err := b.deps.CodeRepos.List()
	if err != nil {
		return adewire.CandidateBranchesResult{}, err
	}
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return adewire.CandidateBranchesResult{}, err
	}
	taken := make(map[string]bool, len(live))
	for _, br := range live {
		taken[br.CodeRepoID+"\x00"+br.Name] = true
	}
	var mu sync.Mutex
	out := make([]adewire.CandidateBranch, 0)
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(boardFanOut)
	for _, rec := range repoList {
		g.Go(func() error {
			found, err := b.repoCandidates(gctx, rec.ID, taken)
			if err != nil {
				return nil // an unreadable repo contributes no candidates
			}
			mu.Lock()
			out = append(out, found...)
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait() // per-repo failures are skipped, never fatal
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].LastCommitAt != out[j].LastCommitAt {
			return out[i].LastCommitAt > out[j].LastCommitAt
		}
		if out[i].CodeRepoID != out[j].CodeRepoID {
			return out[i].CodeRepoID < out[j].CodeRepoID
		}
		return out[i].Name < out[j].Name
	})
	return adewire.CandidateBranchesResult{Branches: out}, nil
}

func (b *TaskBoard) repoCandidates(ctx context.Context, codeRepoID string, taken map[string]bool) ([]adewire.CandidateBranch, error) {
	entry, err := b.openRepo(ctx, codeRepoID)
	if err != nil {
		return nil, err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return nil, err
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return nil, err
	}
	mainName := ""
	if ref, _, ok, err := entry.MainRef(ctx); err == nil && ok {
		mainName, _ = mainDisplay(ref)
	}
	seen := map[string]bool{}
	out := make([]adewire.CandidateBranch, 0)
	for _, remoteOnly := range []bool{false, true} {
		for _, r := range inv {
			if (r.Remote != "") != remoteOnly || r.Short == mainName || seen[r.Short] || taken[codeRepoID+"\x00"+r.Short] {
				continue
			}
			seen[r.Short] = true
			out = append(out, adewire.CandidateBranch{
				CodeRepoID: codeRepoID, Name: r.Short, Author: r.AuthorName, LastCommitAt: r.CommitterUnix * 1000,
				RemoteOnly: remoteOnly, Mine: resolveKind(r, userEmail, "") == model.AdeBranchKindMine,
			})
		}
	}
	return out, nil
}

// AddExistingBranch attaches an existing git branch to a live task, or (taskId "") to a new task:
// a review task when the tip author is not the user, else a plain task. A mine or parked branch that
// is not checked out anywhere gets a worktree and its prepare script (R19); a review branch gets
// none until Start or Take over.
func (b *TaskBoard) AddExistingBranch(ctx context.Context, args adewire.AddExistingBranchArgs) (adewire.AddExistingBranchResult, error) {
	var sb model.AdeTaskBranch
	res, err := b.attachExistingBranch(ctx, args, &sb)
	if err != nil {
		return res, err
	}
	if sb.Kind != model.AdeBranchKindReview {
		b.prepareAttached(ctx, sb)
	}
	return res, nil
}

// prepareAttached gives an attached branch its worktree and setup. A failure leaves the branch
// attached: the next Start or Take over retries through the launch gate.
func (b *TaskBoard) prepareAttached(ctx context.Context, sb model.AdeTaskBranch) {
	rec, err := b.deps.CodeRepos.Get(sb.CodeRepoID)
	if err != nil || rec == nil {
		slog.Warn("ade: attached branch worktree", "scope", "ade", "branch", sb.ID, "err", err)
		return
	}
	res, err := b.ensureWorktree(ctx, "", *rec, sb, "")
	if err != nil {
		slog.Warn("ade: attached branch worktree", "scope", "ade", "branch", sb.ID, "err", err)
		return
	}
	if !res.Fresh {
		return
	}
	if err := b.startSetup(*rec, sb, res.Name, res.Path, b.onSetupReady); err != nil {
		slog.Warn("ade: attached branch setup", "scope", "ade", "branch", sb.ID, "err", err)
	}
	b.notifyBoard()
}

func (b *TaskBoard) attachExistingBranch(ctx context.Context, args adewire.AddExistingBranchArgs, attached *model.AdeTaskBranch) (adewire.AddExistingBranchResult, error) {
	if err := b.requireRepos([]string{args.CodeRepoID}); err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	mu := b.repoMutex(args.CodeRepoID)
	mu.Lock()
	defer mu.Unlock()

	entry, err := b.openRepo(ctx, args.CodeRepoID)
	if err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	remote, _ := entry.DefaultRemote(ctx)
	row, found := resolveQueuedRef(inv, args.Name, remote)
	if !found {
		return adewire.AddExistingBranchResult{}, invalid("branch %q not found", args.Name)
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	for _, br := range live {
		if br.CodeRepoID == args.CodeRepoID && br.Name == args.Name {
			return adewire.AddExistingBranchResult{}, repos.ErrBranchOnTask
		}
	}

	kind := resolveKind(row, userEmail, "")
	now := b.deps.Now().UnixMilli()
	var task model.AdeTask
	var sb model.AdeTaskBranch
	if args.TaskID == "" {
		task = model.AdeTask{ID: b.newID(), Kind: model.AdeTaskKindTask, CreatedAt: now}
		if kind == model.AdeBranchKindReview {
			task.Kind, task.Owner = model.AdeTaskKindReview, row.AuthorName
		}
		sb = model.AdeTaskBranch{ID: b.newID(), TaskID: task.ID, CodeRepoID: args.CodeRepoID, Name: args.Name, Kind: kind, AddedAt: now}
		if task, err = b.deps.Tasks.CreateTask(task, []model.AdeTaskBranch{sb}); err != nil {
			return adewire.AddExistingBranchResult{}, err
		}
	} else {
		if task, err = b.deps.Tasks.GetTask(args.TaskID); err != nil {
			return adewire.AddExistingBranchResult{}, err
		}
		if task.Kind == model.AdeTaskKindParked {
			kind = model.AdeBranchKindParked
		}
		sb, err = b.deps.Tasks.AddBranch(model.AdeTaskBranch{
			ID: b.newID(), TaskID: task.ID, CodeRepoID: args.CodeRepoID, Name: args.Name, Kind: kind, AddedAt: now,
		})
		if err != nil {
			return adewire.AddExistingBranchResult{}, err
		}
	}
	*attached = sb
	b.notifyBoard()
	facts := b.repoFacts(ctx, args.CodeRepoID, []model.AdeTaskBranch{sb}, nil)
	b.applyChecks(args.CodeRepoID, facts)
	wt, err := b.wireTask(task)
	if err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	return adewire.AddExistingBranchResult{Task: wt, Branch: facts.branches[sb.ID]}, nil
}

// SetPlan reorders tasks and sets their days; every id must be a live task.
func (b *TaskBoard) SetPlan(_ context.Context, args adewire.SetPlanArgs) error {
	tasks, err := b.deps.Tasks.ListLive()
	if err != nil {
		return err
	}
	live := make(map[string]bool, len(tasks))
	for _, t := range tasks {
		live[t.ID] = true
	}
	seen := make(map[string]bool, len(args.Order))
	for _, id := range args.Order {
		if !live[id] || seen[id] {
			return invalid("order names %q, which is not a live task listed once", id)
		}
		seen[id] = true
	}
	for id := range args.Days {
		if !live[id] {
			return invalid("days names %q, which is not a live task", id)
		}
	}
	if err := b.deps.Tasks.SetPlan(args.Order, args.Days); err != nil {
		return err
	}
	b.notifyBoard()
	return nil
}

// SetQueuedAfter orders a branch after another branch of the same repo; "" clears it.
func (b *TaskBoard) SetQueuedAfter(_ context.Context, args adewire.SetQueuedAfterArgs) error {
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return err
	}
	byID := make(map[string]model.AdeTaskBranch, len(live))
	for _, br := range live {
		byID[br.ID] = br
	}
	self, ok := byID[args.BranchID]
	if !ok {
		return repos.ErrBranchMissing
	}
	if args.AfterBranchID != "" {
		after, ok := byID[args.AfterBranchID]
		switch {
		case !ok:
			return invalid("afterBranchId %q is not a live branch", args.AfterBranchID)
		case after.ID == self.ID:
			return invalid("a branch cannot be queued after itself")
		case after.CodeRepoID != self.CodeRepoID:
			return invalid("a branch can only be queued after a branch of the same repo")
		}
		if queueCycle(byID, self.ID, after) {
			return invalid("queuing after that branch would form a cycle")
		}
	}
	if err := b.deps.Tasks.SetQueuedAfter(args.BranchID, args.AfterBranchID); err != nil {
		return err
	}
	b.notifyBoard()
	return nil
}

// --- backlog -----------------------------------------------------------------------------------

func toWireBacklog(i model.AdeBacklogItem) adewire.BacklogItem {
	out := adewire.BacklogItem{ID: i.ID, Text: i.Text, AddedAt: i.AddedAt, GithubURL: i.GithubURL, Notes: i.Notes}
	if i.JiraKey != "" || i.JiraURL != "" {
		out.Jira = &adewire.Jira{Key: i.JiraKey, URL: i.JiraURL}
	}
	return out
}

// Backlog lists the items top first.
func (b *TaskBoard) Backlog(_ context.Context) (adewire.BacklogResult, error) {
	items, err := b.deps.Backlog.List()
	if err != nil {
		return adewire.BacklogResult{}, err
	}
	out := adewire.BacklogResult{Items: make([]adewire.BacklogItem, len(items))}
	for i, it := range items {
		out.Items[i] = toWireBacklog(it)
	}
	return out, nil
}

// AddBacklogItem adds an item at the top.
func (b *TaskBoard) AddBacklogItem(_ context.Context, args adewire.AddBacklogItemArgs) (adewire.BacklogItem, error) {
	text := strings.TrimSpace(args.Text)
	if text == "" {
		return adewire.BacklogItem{}, invalid("text is required")
	}
	item, err := b.deps.Backlog.Add(model.AdeBacklogItem{ID: b.newID(), Text: text, AddedAt: b.deps.Now().UnixMilli()})
	if err != nil {
		return adewire.BacklogItem{}, err
	}
	b.notifyBacklog()
	return toWireBacklog(item), nil
}

// UpdateBacklogItem applies a patch.
func (b *TaskBoard) UpdateBacklogItem(_ context.Context, args adewire.UpdateBacklogItemArgs) (adewire.BacklogItem, error) {
	p := args.Patch
	if p.Jira != nil && p.ClearJira {
		return adewire.BacklogItem{}, invalid("jira and clearJira are mutually exclusive")
	}
	patch := model.AdeBacklogPatch{Text: p.Text, GithubURL: p.GithubURL, Notes: p.Notes}
	if p.Text != nil {
		trimmed := strings.TrimSpace(*p.Text)
		if trimmed == "" {
			return adewire.BacklogItem{}, invalid("text must not be empty")
		}
		patch.Text = &trimmed
	}
	switch {
	case p.Jira != nil:
		patch.JiraKey, patch.JiraURL = &p.Jira.Key, &p.Jira.URL
	case p.ClearJira:
		empty := ""
		patch.JiraKey, patch.JiraURL = &empty, &empty
	}
	item, err := b.deps.Backlog.Update(args.ID, patch)
	if err != nil {
		return adewire.BacklogItem{}, err
	}
	b.notifyBacklog()
	return toWireBacklog(item), nil
}

// MoveBacklogItem moves an item to toIndex.
func (b *TaskBoard) MoveBacklogItem(_ context.Context, args adewire.MoveBacklogItemArgs) error {
	if err := b.deps.Backlog.Move(args.ID, args.ToIndex); err != nil {
		return err
	}
	b.notifyBacklog()
	return nil
}

// DeleteBacklogItem removes an item.
func (b *TaskBoard) DeleteBacklogItem(_ context.Context, args adewire.BacklogItemArgs) error {
	if err := b.deps.Backlog.Delete(args.ID); err != nil {
		return err
	}
	b.notifyBacklog()
	return nil
}

// PromoteBacklogItem turns an item into a Later task with no repos and no workflow; the user picks
// both on the task afterwards.
func (b *TaskBoard) PromoteBacklogItem(_ context.Context, args adewire.BacklogItemArgs) (adewire.Task, error) {
	items, err := b.deps.Backlog.List()
	if err != nil {
		return adewire.Task{}, err
	}
	var item *model.AdeBacklogItem
	for i := range items {
		if items[i].ID == args.ID {
			item = &items[i]
		}
	}
	if item == nil {
		return adewire.Task{}, repos.ErrBacklogGone
	}
	task, err := b.deps.Backlog.Promote(item.ID, model.AdeTask{
		ID: b.newID(), Kind: model.AdeTaskKindTask, Title: item.Text, JiraKey: item.JiraKey, JiraURL: item.JiraURL,
		GithubURL: item.GithubURL, Notes: item.Notes, CreatedAt: b.deps.Now().UnixMilli(),
	})
	if err != nil {
		return adewire.Task{}, err
	}
	b.notifyBacklog()
	b.notifyBoard()
	return b.wireTask(task)
}

// --- workflows and repos -----------------------------------------------------------------------

// Workflows lists the workflow files with how many live tasks use each.
func (b *TaskBoard) Workflows(_ context.Context) (adewire.WorkflowsResult, error) {
	usedBy, err := b.workflowUsage()
	if err != nil {
		return adewire.WorkflowsResult{}, err
	}
	return b.deps.Workflows.List(usedBy), nil
}

// Repos lists every code repo with its ade config and the folders it was imported from.
func (b *TaskBoard) Repos(_ context.Context) (adewire.ReposResult, error) {
	configs, err := b.deps.RepoConfig.List()
	if err != nil {
		return adewire.ReposResult{}, err
	}
	folders, err := b.deps.RepoConfig.Folders()
	if err != nil {
		return adewire.ReposResult{}, err
	}
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return adewire.ReposResult{}, err
	}
	used := make(map[string]bool)
	for _, br := range live {
		used[br.CodeRepoID] = true
	}
	out := adewire.ReposResult{Repos: make([]adewire.Repo, 0, len(configs)), Folders: make([]adewire.Folder, 0, len(folders))}
	for _, c := range configs {
		prepare, timeout := "", model.DefaultPrepareTimeout
		if b.deps.GitRepoSettings != nil {
			if s, err := b.deps.GitRepoSettings(c.RepoID); err == nil {
				prepare, timeout = s.WorktreePrepareScript, s.WorktreePrepareTimeout
			}
		}
		r := adewire.Repo{
			CodeRepoID: c.CodeRepoID, Name: c.Name, Nickname: c.Nickname, Path: c.Root, Source: c.Source,
			UsedByTasks: used[c.CodeRepoID], IntegrationBranches: nonNil(c.IntegrationBranches),
			PrepareScript: prepare, PrepareTimeout: timeout, Environments: make([]adewire.Environment, len(c.Environments)),
		}
		for i, e := range c.Environments {
			r.Environments[i] = adewire.Environment{Name: e.Name, DeployedShaScript: e.DeployedShaScript}
		}
		out.Repos = append(out.Repos, r)
	}
	for _, f := range folders {
		out.Folders = append(out.Folders, adewire.Folder{Path: f.Path, Watch: f.Watch, RepoCount: f.RepoCount})
	}
	return out, nil
}

// queueCycle reports whether walking parents from start reaches selfID. The Plan orders a branch
// by its queue link, else by the live branch of its repo that its base names (resolveBase).
func queueCycle(byID map[string]model.AdeTaskBranch, selfID string, start model.AdeTaskBranch) bool {
	byName := make(map[[2]string]string, len(byID))
	for _, br := range byID {
		if br.Name != "" {
			byName[[2]string{br.CodeRepoID, br.Name}] = br.ID
		}
	}
	cur := start
	for range len(byID) + 1 {
		parent := cur.QueuedAfter
		if parent == "" && cur.Base != "" {
			parent = byName[[2]string{cur.CodeRepoID, cur.Base}]
		}
		if parent == "" || parent == cur.ID {
			return false
		}
		if parent == selfID {
			return true
		}
		next, ok := byID[parent]
		if !ok {
			return false
		}
		cur = next
	}
	return true
}
