package bridge

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

const (
	adeTaskMaxColor    = 20
	adeTaskMaxRepoIDs  = 64
	adeTaskMaxPlanKeys = 10_000
	adeMaxYamlBytes    = 1 << 20
	adeMaxPathBytes    = 4096
	adeMaxIntegration  = 32
	adeMaxEnvironments = 32
	adeMaxScriptBytes  = 64 << 10
)

// AdeTaskService is the v2 ADE task surface (P144): board snapshot, task/plan/backlog writes and
// workflow/repo reads. Run, session and workflow-edit methods land with later waves.
type AdeTaskService struct {
	Engine *ade.TaskBoard
	// Registry, Emit and FocusWindow serve FocusSession; nil in a fixture that never calls it.
	// FocusWindow is a func field, not a method, so it adds nothing to the bound surface.
	Registry    *terminal.Registry
	Emit        appcore.Emitter
	FocusWindow func(key string) bool
	// OpenWindow, CloseWindow and SetWindowTitle serve review windows; func fields like FocusWindow.
	OpenWindow     func(rec shell.WindowRecord)
	CloseWindow    func(key string) bool
	SetWindowTitle func(key, title string)
}

// AdeTaskOpenSession is FocusSession's emit half: addressed to the one window just brought forward.
func AdeTaskOpenSession(e appcore.Emitter, windowKey string, payload adewire.OpenSessionEvent) {
	e.EmitTo(windowKey, adewire.ChannelOpenSession, payload)
}

// AdeTaskBoardChanged is TaskBoard.OnBoard's target: payload-free, every window re-fetches Board.
func AdeTaskBoardChanged(ev *Events) { ev.Broadcast(adewire.ChannelBoard) }

// AdeTaskBacklogChanged is TaskBoard.OnBacklog's target: payload-free.
func AdeTaskBacklogChanged(ev *Events) { ev.Broadcast(adewire.ChannelBacklog) }

// AdeTaskRunsChanged is TaskBoard.OnRuns' target: the changed runs ride the event.
func AdeTaskRunsChanged(ev *Events, payload adewire.RunsChangedEvent) {
	ev.emit.Emit(adewire.ChannelRuns, payload)
}

// AdeTaskLogAppended is TaskBoard.OnLog's target: one stored batch of log chunks.
func AdeTaskLogAppended(ev *Events, payload adewire.LogEvent) {
	ev.emit.Emit(adewire.ChannelLog, payload)
}

// AdeTaskSessionsChanged is TaskBoard.OnSessions' target: payload-free.
func AdeTaskSessionsChanged(ev *Events) { ev.Broadcast(adewire.ChannelSessions) }

// AdeTaskWorkflowsChanged is TaskBoard.OnWorkflows' target: payload-free.
func AdeTaskWorkflowsChanged(ev *Events) { ev.Broadcast(adewire.ChannelWorkflows) }

// AdeTaskReposChanged is TaskBoard.OnRepos' target: payload-free.
func AdeTaskReposChanged(ev *Events) { ev.Broadcast(adewire.ChannelRepos) }

// adeTaskError maps store and engine sentinels to wire codes.
func adeTaskError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ade.ErrInvalidInput), errors.Is(err, repos.ErrEstimateShrink),
		errors.Is(err, repos.ErrBranchOnTask), errors.Is(err, repos.ErrRepoOnTask),
		errors.Is(err, repos.ErrReviewKind):
		return ipcerr.New("E_INVALID", err.Error())
	case errors.Is(err, ade.ErrSessionWrongTask), errors.Is(err, ade.ErrSessionRunning),
		errors.Is(err, ade.ErrSessionNotRunning), errors.Is(err, ade.ErrCommandMismatch),
		errors.Is(err, ade.ErrResumeCwdNotDir):
		return ipcerr.New("E_INVALID", err.Error())
	case errors.Is(err, repos.ErrTaskNotFound), errors.Is(err, repos.ErrBranchMissing),
		errors.Is(err, repos.ErrBacklogGone), errors.Is(err, repos.ErrRunNotFound),
		errors.Is(err, ade.ErrSessionNotFound):
		return ipcerr.New("E_NOT_FOUND", err.Error())
	}
	return ipcerr.InternalErr(err)
}

var adeWorkflowIDRe = regexp.MustCompile(`^[a-z0-9_-]{1,64}$`)

func adeTaskInvalid(msg string) error { return ipcerr.New("E_INVALID", msg) }

func validateAdeTaskID(value, field string) error { return validateAdeItemID(value, field) }

func validateAdeTaskJira(j *adewire.Jira) error {
	if j == nil {
		return nil
	}
	return validateAdeJira(j.Key, j.URL)
}

func validateAdeTaskRepoIDs(ids []string) error {
	if len(ids) > adeTaskMaxRepoIDs {
		return adeTaskInvalid("codeRepoIds is too long")
	}
	for _, id := range ids {
		if err := validateAdeItemID(id, "codeRepoIds"); err != nil {
			return err
		}
	}
	return nil
}

func validateCreateTask(a adewire.CreateTaskArgs) error {
	if err := validateAdeName(a.Title, "title"); err != nil {
		return err
	}
	if err := validateAdeTaskJira(a.Jira); err != nil {
		return err
	}
	if err := validateAdeURL(a.GithubURL, "githubUrl"); err != nil {
		return err
	}
	if err := validateAdeNotes(a.Notes); err != nil {
		return err
	}
	if len(a.WorkflowID) > adeMaxBranchBytes {
		return adeTaskInvalid("workflowId is too long")
	}
	return validateAdeTaskRepoIDs(a.CodeRepoIDs)
}

func validateUpdateTask(a adewire.UpdateTaskArgs) error {
	if err := validateAdeTaskID(a.TaskID, "taskId"); err != nil {
		return err
	}
	p := a.Patch
	if p.Title != nil {
		if err := validateAdeName(*p.Title, "title"); err != nil {
			return err
		}
	}
	if err := validateAdeTaskJira(p.Jira); err != nil {
		return err
	}
	if p.GithubURL != nil {
		if err := validateAdeURL(*p.GithubURL, "githubUrl"); err != nil {
			return err
		}
	}
	if p.Est != nil {
		if err := validateAdeEst(*p.Est); err != nil {
			return err
		}
	}
	if p.Notes != nil {
		if err := validateAdeNotes(*p.Notes); err != nil {
			return err
		}
	}
	if p.Color != nil && (*p.Color < 0 || *p.Color >= adeTaskMaxColor) {
		return adeTaskInvalid("color is out of range")
	}
	if p.Kind != nil && *p.Kind != "task" && *p.Kind != "parked" {
		return adeTaskInvalid("kind must be task or parked")
	}
	return nil
}

func validateSetPlan(a adewire.SetPlanArgs) error {
	if len(a.Order) > adeTaskMaxPlanKeys || len(a.Days) > adeTaskMaxPlanKeys {
		return adeTaskInvalid("plan is too large")
	}
	for _, id := range a.Order {
		if err := validateAdeTaskID(id, "order"); err != nil {
			return err
		}
	}
	for id, day := range a.Days {
		if err := validateAdeTaskID(id, "days"); err != nil {
			return err
		}
		if day != nil {
			if err := validateAdeISODate(*day); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateBacklogPatch(p adewire.BacklogPatch) error {
	if p.Text != nil {
		if err := validateAdeName(*p.Text, "text"); err != nil {
			return err
		}
	}
	if err := validateAdeTaskJira(p.Jira); err != nil {
		return err
	}
	if p.GithubURL != nil {
		if err := validateAdeURL(*p.GithubURL, "githubUrl"); err != nil {
			return err
		}
	}
	if p.Notes != nil {
		return validateAdeNotes(*p.Notes)
	}
	return nil
}

// --- reads -------------------------------------------------------------------------------------

func (s *AdeTaskService) Board(ctx context.Context) (adewire.Board, error) {
	b, err := s.Engine.Board(ctx)
	return b, adeTaskError(err)
}

func (s *AdeTaskService) Prs(ctx context.Context) (adewire.PrsResult, error) {
	r, err := s.Engine.Prs(ctx)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) Refresh(ctx context.Context, args adewire.RefreshArgs) (adewire.RefreshResult, error) {
	if err := validateAdeTaskRepoIDs(args.CodeRepoIDs); err != nil {
		return adewire.RefreshResult{}, err
	}
	r, err := s.Engine.Refresh(ctx, args.CodeRepoIDs)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) ForcePush(ctx context.Context, args adewire.BranchArgs) (adewire.ForcePushResult, error) {
	if err := validateAdeTaskID(args.BranchID, "branchId"); err != nil {
		return adewire.ForcePushResult{}, err
	}
	r, err := s.Engine.ForcePush(ctx, args.BranchID)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) CandidateBranches(ctx context.Context) (adewire.CandidateBranchesResult, error) {
	r, err := s.Engine.CandidateBranches(ctx)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) Backlog(ctx context.Context) (adewire.BacklogResult, error) {
	r, err := s.Engine.Backlog(ctx)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) Workflows(ctx context.Context) (adewire.WorkflowsResult, error) {
	r, err := s.Engine.Workflows(ctx)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) Repos(ctx context.Context) (adewire.ReposResult, error) {
	r, err := s.Engine.Repos(ctx)
	return r, adeTaskError(err)
}

// --- writes ------------------------------------------------------------------------------------

func (s *AdeTaskService) CreateTask(ctx context.Context, args adewire.CreateTaskArgs) (adewire.Task, error) {
	if err := validateCreateTask(args); err != nil {
		return adewire.Task{}, err
	}
	t, err := s.Engine.CreateTask(ctx, args)
	return t, adeTaskError(err)
}

func (s *AdeTaskService) UpdateTask(ctx context.Context, args adewire.UpdateTaskArgs) (adewire.Task, error) {
	if err := validateUpdateTask(args); err != nil {
		return adewire.Task{}, err
	}
	t, err := s.Engine.UpdateTask(ctx, args)
	return t, adeTaskError(err)
}

func (s *AdeTaskService) AddTaskRepo(ctx context.Context, args adewire.AddTaskRepoArgs) (adewire.Branch, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.Branch{}, err
	}
	if err := validateAdeTaskID(args.CodeRepoID, "codeRepoId"); err != nil {
		return adewire.Branch{}, err
	}
	br, err := s.Engine.AddTaskRepo(ctx, args)
	return br, adeTaskError(err)
}

func (s *AdeTaskService) AddExistingBranch(ctx context.Context, args adewire.AddExistingBranchArgs) (adewire.AddExistingBranchResult, error) {
	if err := validateAdeTaskID(args.CodeRepoID, "codeRepoId"); err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	if err := validateAdeBranchName(args.Name, "name"); err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	if args.TaskID != "" { // '' = new task (wire contract)
		if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
			return adewire.AddExistingBranchResult{}, err
		}
	}
	r, err := s.Engine.AddExistingBranch(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) SetPlan(ctx context.Context, args adewire.SetPlanArgs) error {
	if err := validateSetPlan(args); err != nil {
		return err
	}
	return adeTaskError(s.Engine.SetPlan(ctx, args))
}

func (s *AdeTaskService) SetQueuedAfter(ctx context.Context, args adewire.SetQueuedAfterArgs) error {
	if err := validateAdeTaskID(args.BranchID, "branchId"); err != nil {
		return err
	}
	if args.AfterBranchID != "" {
		if err := validateAdeTaskID(args.AfterBranchID, "afterBranchId"); err != nil {
			return err
		}
	}
	return adeTaskError(s.Engine.SetQueuedAfter(ctx, args))
}

func (s *AdeTaskService) AddBacklogItem(ctx context.Context, args adewire.AddBacklogItemArgs) (adewire.BacklogItem, error) {
	if strings.TrimSpace(args.Text) == "" {
		return adewire.BacklogItem{}, adeTaskInvalid("text is required")
	}
	if err := validateAdeName(args.Text, "text"); err != nil {
		return adewire.BacklogItem{}, err
	}
	it, err := s.Engine.AddBacklogItem(ctx, args)
	return it, adeTaskError(err)
}

func (s *AdeTaskService) UpdateBacklogItem(ctx context.Context, args adewire.UpdateBacklogItemArgs) (adewire.BacklogItem, error) {
	if err := validateAdeTaskID(args.ID, "id"); err != nil {
		return adewire.BacklogItem{}, err
	}
	if err := validateBacklogPatch(args.Patch); err != nil {
		return adewire.BacklogItem{}, err
	}
	it, err := s.Engine.UpdateBacklogItem(ctx, args)
	return it, adeTaskError(err)
}

func (s *AdeTaskService) MoveBacklogItem(ctx context.Context, args adewire.MoveBacklogItemArgs) error {
	if err := validateAdeTaskID(args.ID, "id"); err != nil {
		return err
	}
	if args.ToIndex < 0 {
		return adeTaskInvalid("toIndex must not be negative")
	}
	return adeTaskError(s.Engine.MoveBacklogItem(ctx, args))
}

func (s *AdeTaskService) DeleteBacklogItem(ctx context.Context, args adewire.BacklogItemArgs) error {
	if err := validateAdeTaskID(args.ID, "id"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.DeleteBacklogItem(ctx, args))
}

func (s *AdeTaskService) PromoteBacklogItem(ctx context.Context, args adewire.BacklogItemArgs) (adewire.Task, error) {
	if err := validateAdeTaskID(args.ID, "id"); err != nil {
		return adewire.Task{}, err
	}
	t, err := s.Engine.PromoteBacklogItem(ctx, args)
	return t, adeTaskError(err)
}

// --- workflow files and repo config (P145) -------------------------------------------------------

func validateAdeYaml(src string) error {
	if len(src) > adeMaxYamlBytes {
		return adeTaskInvalid("yaml is too large")
	}
	return nil
}

func validateAdePath(path, field string) error {
	if path == "" {
		return adeTaskInvalid(field + " is required")
	}
	if len(path) > adeMaxPathBytes || strings.ContainsRune(path, 0) {
		return adeTaskInvalid(field + " is invalid")
	}
	return nil
}

func validateUpdateRepo(a adewire.UpdateRepoArgs) error {
	if err := validateAdeItemID(a.CodeRepoID, "codeRepoId"); err != nil {
		return err
	}
	p := a.Patch
	if p.Nickname != nil {
		if err := validateAdeName(*p.Nickname, "nickname"); err != nil {
			return err
		}
	}
	if p.IntegrationBranches != nil {
		if len(*p.IntegrationBranches) > adeMaxIntegration {
			return adeTaskInvalid("integrationBranches is too long")
		}
		for _, name := range *p.IntegrationBranches {
			if err := validateAdeBranchName(name, "integrationBranches"); err != nil {
				return err
			}
		}
	}
	if p.PrepareScript != nil && len(*p.PrepareScript) > adeMaxScriptBytes {
		return adeTaskInvalid("prepareScript is too large")
	}
	if p.Environments != nil {
		if len(*p.Environments) > adeMaxEnvironments {
			return adeTaskInvalid("environments is too long")
		}
		for _, env := range *p.Environments {
			if err := validateAdeName(env.Name, "environment name"); err != nil {
				return err
			}
			if len(env.DeployedShaScript) > adeMaxScriptBytes {
				return adeTaskInvalid("deployedShaScript is too large")
			}
		}
	}
	return nil
}

func (s *AdeTaskService) WorkflowYaml(ctx context.Context, args adewire.FileNameArgs) (adewire.WorkflowYaml, error) {
	if err := validateAdeBranchName(args.FileName, "fileName"); err != nil {
		return adewire.WorkflowYaml{}, err
	}
	r, err := s.Engine.WorkflowYaml(ctx, args.FileName)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) ValidateWorkflowYaml(ctx context.Context, args adewire.ValidateWorkflowYamlArgs) (adewire.WorkflowValidation, error) {
	if err := validateAdeYaml(args.Yaml); err != nil {
		return adewire.WorkflowValidation{}, err
	}
	return s.Engine.ValidateWorkflowYaml(ctx, args.Yaml), nil
}

func (s *AdeTaskService) SaveWorkflow(ctx context.Context, args adewire.SaveWorkflowArgs) (adewire.WorkflowEntry, error) {
	if err := validateAdeBranchName(args.FileName, "fileName"); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	r, err := s.Engine.SaveWorkflow(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) SaveWorkflowYaml(ctx context.Context, args adewire.SaveWorkflowYamlArgs) (adewire.WorkflowEntry, error) {
	if err := validateAdeBranchName(args.FileName, "fileName"); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	if err := validateAdeYaml(args.Yaml); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	r, err := s.Engine.SaveWorkflowYaml(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) ImportWorkflow(ctx context.Context, args adewire.ImportWorkflowArgs) (adewire.WorkflowEntry, error) {
	if err := validateAdePath(args.Path, "path"); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	r, err := s.Engine.ImportWorkflow(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) NewWorkflow(ctx context.Context, args adewire.NewWorkflowArgs) (adewire.WorkflowEntry, error) {
	if err := validateAdeName(args.Name, "name"); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	r, err := s.Engine.NewWorkflow(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) UpdateRepo(ctx context.Context, args adewire.UpdateRepoArgs) (adewire.Repo, error) {
	if err := validateUpdateRepo(args); err != nil {
		return adewire.Repo{}, err
	}
	r, err := s.Engine.UpdateRepo(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) AddFolder(ctx context.Context, args adewire.FolderArgs) (adewire.FolderImportResult, error) {
	if err := validateAdePath(args.Path, "path"); err != nil {
		return adewire.FolderImportResult{}, err
	}
	r, err := s.Engine.AddFolder(ctx, args.Path, args.Watch)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) SetFolderWatch(ctx context.Context, args adewire.FolderArgs) (adewire.Folder, error) {
	if err := validateAdePath(args.Path, "path"); err != nil {
		return adewire.Folder{}, err
	}
	r, err := s.Engine.SetFolderWatch(ctx, args.Path, args.Watch)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) RemoveFolder(ctx context.Context, args adewire.PathArgs) error {
	if err := validateAdePath(args.Path, "path"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.RemoveFolder(ctx, args.Path))
}

func (s *AdeTaskService) RecordMerge(ctx context.Context, args adewire.RecordMergeArgs) error {
	if err := validateAdeItemID(args.BranchID, "branchId"); err != nil {
		return err
	}
	if err := validateAdeBranchName(args.Target, "target"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.RecordMerge(ctx, args.BranchID, args.Target))
}

// --- runs --------------------------------------------------------------------------------------

func (s *AdeTaskService) StartRun(ctx context.Context, args adewire.StartRunArgs) (adewire.StartRunResult, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.StartRunResult{}, err
	}
	if len(args.BranchNames) > adeTaskMaxRepoIDs {
		return adewire.StartRunResult{}, adeTaskInvalid("branchNames is too long")
	}
	for id, name := range args.BranchNames {
		if err := validateAdeItemID(id, "branchNames"); err != nil {
			return adewire.StartRunResult{}, err
		}
		if name == "" {
			continue
		}
		if err := validateAdeBranchName(name, "branchNames"); err != nil {
			return adewire.StartRunResult{}, err
		}
	}
	if len(args.Message) > adeMaxMessageBytes {
		return adewire.StartRunResult{}, adeTaskInvalid("message is too long")
	}
	r, err := s.Engine.StartRun(ctx, args)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) SetTaskWorkflow(ctx context.Context, args adewire.SetTaskWorkflowArgs) (adewire.Task, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.Task{}, err
	}
	if args.WorkflowID != "" && !adeWorkflowIDRe.MatchString(args.WorkflowID) {
		return adewire.Task{}, adeTaskInvalid("workflowId must be 1-64 chars of a-z, 0-9, _ or -")
	}
	t, err := s.Engine.SetTaskWorkflow(ctx, args)
	return t, adeTaskError(err)
}

func (s *AdeTaskService) Approve(ctx context.Context, args adewire.StepArgs) error {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return err
	}
	if err := validateAdeItemID(args.StageID, "stageId"); err != nil {
		return err
	}
	if err := validateAdeItemID(args.StepID, "stepId"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.Approve(ctx, args))
}

func (s *AdeTaskService) RetryRun(ctx context.Context, args adewire.RunArgs) error {
	if err := validateAdeItemID(args.RunID, "runId"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.RetryRun(ctx, args.RunID))
}

func (s *AdeTaskService) StageDone(ctx context.Context, args adewire.TaskArgs) (adewire.Task, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.Task{}, err
	}
	t, err := s.Engine.StageDone(ctx, args.TaskID)
	return t, adeTaskError(err)
}

func (s *AdeTaskService) RetrySetup(ctx context.Context, args adewire.BranchArgs) error {
	if err := validateAdeItemID(args.BranchID, "branchId"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.RetrySetup(ctx, args.BranchID))
}

func (s *AdeTaskService) ReadLog(ctx context.Context, args adewire.ReadLogArgs) (adewire.LogPage, error) {
	if args.Kind != "run" && args.Kind != "setup" {
		return adewire.LogPage{}, adeTaskInvalid("kind must be run or setup")
	}
	if err := validateAdeItemID(args.ID, "id"); err != nil {
		return adewire.LogPage{}, err
	}
	if args.AfterSeq < 0 {
		return adewire.LogPage{}, adeTaskInvalid("afterSeq must not be negative")
	}
	p, err := s.Engine.ReadLog(ctx, args)
	return p, adeTaskError(err)
}

func (s *AdeTaskService) Sessions(ctx context.Context) (adewire.SessionsResult, error) {
	r, err := s.Engine.Sessions(ctx)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) StopRun(ctx context.Context, args adewire.RunArgs) error {
	if err := validateAdeItemID(args.RunID, "runId"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.StopRun(ctx, args.RunID))
}

func (s *AdeTaskService) TakeOver(ctx context.Context, args adewire.TakeOverArgs) (adewire.Launch, error) {
	if err := validateAdeItemID(args.SessionID, "sessionId"); err != nil {
		return adewire.Launch{}, err
	}
	l, err := s.Engine.TakeOver(ctx, args)
	return l, adeTaskError(err)
}

func (s *AdeTaskService) LaunchStage(ctx context.Context, args adewire.LaunchStageArgs) (adewire.Launch, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.Launch{}, err
	}
	if len(args.Message) > adeMaxMessageBytes {
		return adewire.Launch{}, adeTaskInvalid("message is too long")
	}
	l, err := s.Engine.LaunchStage(ctx, args)
	return l, adeTaskError(err)
}

func (s *AdeTaskService) StartBranch(ctx context.Context, args adewire.StartBranchArgs) (adewire.Launch, error) {
	if err := validateAdeItemID(args.BranchID, "branchId"); err != nil {
		return adewire.Launch{}, err
	}
	if len(args.Message) > adeMaxMessageBytes {
		return adewire.Launch{}, adeTaskInvalid("message is too long")
	}
	l, err := s.Engine.StartBranch(ctx, args)
	return l, adeTaskError(err)
}

func (s *AdeTaskService) Send(ctx context.Context, args adewire.SendArgs) error {
	if err := validateAdeItemID(args.SessionID, "sessionId"); err != nil {
		return err
	}
	if args.Message == "" {
		return adeTaskInvalid("message is required")
	}
	if len(args.Message) > adeMaxMessageBytes {
		return adeTaskInvalid("message is too long")
	}
	return adeTaskError(s.Engine.Send(ctx, args))
}

// FocusSession brings the window that owns a running session's terminal forward and tells it which
// task, branch and session to show. It returns false, never an error, when the session stopped or its
// window closed meanwhile.
func (s *AdeTaskService) FocusSession(_ context.Context, args adewire.FocusSessionArgs) (bool, error) {
	if err := validateAdeItemID(args.SessionID, "sessionId"); err != nil {
		return false, err
	}
	if args.TaskID != "" {
		if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
			return false, err
		}
	}
	rec, err := s.Engine.TUISession(args.SessionID)
	if err != nil {
		return false, adeTaskError(err)
	}
	if rec == nil {
		return false, adeTaskError(ade.ErrSessionNotFound)
	}
	if rec.Mode != model.AdeSessionModeTUI || rec.State != model.AdeSessionStateRunning || s.Registry == nil {
		return false, nil
	}
	windowKey, ok := s.Registry.WindowOf(rec.TerminalID)
	if !ok || s.FocusWindow == nil || !s.FocusWindow(windowKey) {
		return false, nil
	}
	taskID := args.TaskID
	if taskID == "" {
		taskID = rec.TaskID
	}
	AdeTaskOpenSession(s.Emit, windowKey, adewire.OpenSessionEvent{TaskID: taskID, BranchID: rec.BranchID, SessionID: rec.ID})
	return true, nil
}

func (s *AdeTaskService) ArchiveRisk(ctx context.Context, args adewire.TaskArgs) (adewire.ArchiveRisk, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.ArchiveRisk{}, err
	}
	r, err := s.Engine.ArchiveRisk(ctx, args.TaskID)
	return r, adeTaskError(err)
}

func (s *AdeTaskService) ArchiveTask(ctx context.Context, args adewire.TaskArgs) error {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return err
	}
	return adeTaskError(s.Engine.ArchiveTask(ctx, args.TaskID))
}

// OpenReviewWindow opens the branch's review window, or focuses it when already open. true = opened.
func (s *AdeTaskService) OpenReviewWindow(ctx context.Context, args adewire.BranchArgs) (bool, error) {
	if err := validateAdeItemID(args.BranchID, "branchId"); err != nil {
		return false, err
	}
	if s.OpenWindow == nil || s.FocusWindow == nil {
		return false, adeTaskInvalid("review windows are not available")
	}
	res, err := s.Engine.OpenReviewWindow(ctx, args.BranchID)
	if err != nil {
		return false, adeTaskError(err)
	}
	if res.Existing {
		s.FocusWindow(res.Key)
		return false, nil
	}
	s.OpenWindow(shell.WindowRecord{Key: res.Key, Order: res.Order})
	if s.SetWindowTitle != nil {
		s.SetWindowTitle(res.Key, res.Title)
	}
	return true, nil
}

// ReviewWindowTarget returns what the window with this key reviews, null when it is no review window.
func (s *AdeTaskService) ReviewWindowTarget(ctx context.Context, args adewire.WindowKeyArgs) (*adewire.ReviewWindowTarget, error) {
	if err := validateAdeItemID(args.WindowKey, "windowKey"); err != nil {
		return nil, err
	}
	t, err := s.Engine.ReviewWindowTarget(ctx, args.WindowKey)
	return t, adeTaskError(err)
}

// ReviewAgent returns the task's review agent session and, when it runs, the window hosting its terminal.
func (s *AdeTaskService) ReviewAgent(_ context.Context, args adewire.TaskArgs) (adewire.ReviewAgentState, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.ReviewAgentState{}, err
	}
	sess, err := s.Engine.ReviewAgent(args.TaskID)
	if err != nil {
		return adewire.ReviewAgentState{}, adeTaskError(err)
	}
	out := adewire.ReviewAgentState{Session: sess}
	if sess != nil && sess.State == model.AdeSessionStateRunning && sess.TerminalID != "" && s.Registry != nil {
		if key, ok := s.Registry.WindowOf(sess.TerminalID); ok {
			out.HostWindowKey = key
		}
	}
	return out, nil
}

// LaunchReviewAgent starts or resumes the task's review agent. E_INVALID when one already runs.
func (s *AdeTaskService) LaunchReviewAgent(ctx context.Context, args adewire.TaskArgs) (adewire.ReviewAgentLaunch, error) {
	if err := validateAdeTaskID(args.TaskID, "taskId"); err != nil {
		return adewire.ReviewAgentLaunch{}, err
	}
	l, err := s.Engine.LaunchReviewAgent(ctx, args.TaskID)
	return l, adeTaskError(err)
}

// GitHubSyncPlan reports what syncing the branch's reviewed files to its PR would do.
func (s *AdeTaskService) GitHubSyncPlan(ctx context.Context, args adewire.BranchArgs) (adewire.GhSyncPlan, error) {
	if err := validateAdeTaskID(args.BranchID, "branchId"); err != nil {
		return adewire.GhSyncPlan{}, err
	}
	p, err := s.Engine.GitHubSyncPlan(ctx, args.BranchID)
	return p, adeTaskError(err)
}

// GitHubSyncApply marks and unmarks the branch's files on its PR as planned.
func (s *AdeTaskService) GitHubSyncApply(ctx context.Context, args adewire.BranchArgs) (adewire.GhSyncResult, error) {
	if err := validateAdeTaskID(args.BranchID, "branchId"); err != nil {
		return adewire.GhSyncResult{}, err
	}
	r, err := s.Engine.GitHubSyncApply(ctx, args.BranchID)
	return r, adeTaskError(err)
}
