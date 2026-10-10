package model

import (
	"fmt"

	"github.com/kirathecat/kira-studio/internal/runoutcome"
)

// AdeTaskKind* are ade_tasks.kind's CHECK values; AdeBranchKind* (below) are the branch kinds.
const (
	AdeTaskKindTask   = "task"
	AdeTaskKindReview = "review"
	AdeTaskKindParked = "parked"
)

// ValidAdeTaskKind mirrors ade_tasks.kind's CHECK.
func ValidAdeTaskKind(v string) bool {
	return v == AdeTaskKindTask || v == AdeTaskKindReview || v == AdeTaskKindParked
}

// AdeRunState* mirror ade_runs.state's CHECK; AdeSetupState* mirror ade_worktree_setup.state's.
const (
	AdeSetupRunning = "running"
	AdeSetupReady   = "ready"
	AdeSetupFailed  = "failed"
)

// AdeTask is one row of ade_tasks. CurrentStageJSON is the stage snapshot taken on stage entry;
// "" stores NULL. WorkflowJSON is the whole workflow the task began with ("" = not started, follows
// the live file) and WorkflowHash its content hash.
type AdeTask struct {
	ID               string
	Kind             string
	Title            string
	Owner            string
	JiraKey          string
	JiraURL          string
	GithubURL        string
	WorkflowID       string
	StageID          string
	CurrentStageJSON string
	WorkflowJSON     string
	WorkflowHash     string
	Est              string
	Notes            string
	Color            int
	CreatedAt        int64
	ArchivedAt       *int64
}

// Validate asserts what no SQL constraint covers.
func (t AdeTask) Validate() error {
	if t.ID == "" {
		return fmt.Errorf("model: ade task: id is required")
	}
	if !ValidAdeTaskKind(t.Kind) {
		return fmt.Errorf("model: ade task %q: invalid kind %q", t.ID, t.Kind)
	}
	return nil
}

// AdeTaskPatch holds only the leaves the caller changes; nil = unchanged.
type AdeTaskPatch struct {
	Title     *string
	JiraKey   *string
	JiraURL   *string
	GithubURL *string
	Est       *string
	Notes     *string
	Color     *int
	Kind      *string
}

// AdeTaskBranch is one row of ade_task_branches. Name "" = branch not created yet.
type AdeTaskBranch struct {
	ID         string
	TaskID     string
	CodeRepoID string
	Name       string
	Kind       string
	Base       string
	// BaseBranchID is the live planner branch this one stacks on ("" = none); Base then holds that
	// branch's name ("" while it is a draft).
	BaseBranchID string
	// BasePendingFrom is the display name of the previous base while a Change base has no verified
	// rebase yet ("" otherwise).
	BasePendingFrom string
	QueuedAfter     string
	Position        int
	HadCommits      bool
	AddedAt         int64
	MergedAt        *int64
	ArchivedAt      *int64
	Origin          string
}

// AdeBranchOriginAgent marks a branch an agent declared or named.
const AdeBranchOriginAgent = "agent"

// Validate asserts what no SQL constraint covers.
func (b AdeTaskBranch) Validate() error {
	if b.ID == "" || b.TaskID == "" || b.CodeRepoID == "" {
		return fmt.Errorf("model: ade task branch: id, taskId and codeRepoId are required")
	}
	if !ValidAdeBranchKind(b.Kind) {
		return fmt.Errorf("model: ade task branch %q: invalid kind %q", b.ID, b.Kind)
	}
	return nil
}

// AdeTaskPlanRow is one row of ade_task_plan; Day nil = Later.
type AdeTaskPlanRow struct {
	TaskID   string
	Day      *string
	Position int
}

// AdeRun is one row of ade_runs.
type AdeRun struct {
	ID         string
	TaskID     string
	StageID    string
	StepID     string
	BranchID   string
	Attempt    int
	State      string
	Loops      int
	Note       string
	Summary    string
	SessionID  string
	ExitCode   *int
	StartedAt  *int64
	FinishedAt *int64
	Outcome    *AdeRunOutcome
	// Purpose is AdeRunPurposeRebase for a rebase run (outside the workflow), "" for a step run.
	Purpose string
	// SpecJSON is a rebase run's AdeRebaseSpec ("" otherwise).
	SpecJSON string
	Launch   AdeRunLaunch
}

// AdeRunPurposeRebase mirrors ade_runs.purpose's CHECK.
const AdeRunPurposeRebase = "rebase"

// AdeRunOutcome is a run's stored end state: the shared outcome plus what the agent reported and
// what git showed.
type AdeRunOutcome struct {
	runoutcome.Outcome
	Report *AgentReport `json:"report,omitempty"`
	Rebase *RebaseFacts `json:"rebase,omitempty"`
	// Route is where the run's result sent the step: next, end, stop, a later step id, `back:<step id>`
	// for a loop to an earlier step or `retry` for one to the step itself.
	Route string `json:"route,omitempty"`
}

// AgentReport is the optional detail of a finish_step call.
type AgentReport struct {
	ConflictedFiles []string `json:"conflictedFiles,omitempty"`
	LastGitError    string   `json:"lastGitError,omitempty"`
	Tried           string   `json:"tried,omitempty"`
}

// RebaseFacts is what git showed after a rebase run ended.
type RebaseFacts struct {
	Verified        bool         `json:"verified"`
	InProgress      bool         `json:"inProgress"`
	Aborted         bool         `json:"aborted"`
	OntoRef         string       `json:"ontoRef"`
	OntoTip         string       `json:"ontoTip"`
	ConflictedFiles []string     `json:"conflictedFiles"`
	Branches        []BranchShas `json:"branches"`
	Pushed          *bool        `json:"pushed"`
}

// BranchShas is one rebased branch's tip before and after, and whether it sits on its base.
type BranchShas struct {
	BranchID string `json:"branchId"`
	Name     string `json:"name"`
	Before   string `json:"before"`
	After    string `json:"after"`
	OnBase   bool   `json:"onBase"`
}

// AdeRebaseSpec is a rebase run's plan, stored in ade_runs.spec_json.
type AdeRebaseSpec struct {
	CodeRepoID    string           `json:"codeRepoId"`
	Repo          string           `json:"repo"`
	Remote        string           `json:"remote"`
	OntoRef       string           `json:"ontoRef"`
	OntoName      string           `json:"ontoName"`
	OntoTipBefore string           `json:"ontoTipBefore"`
	ChangeBase    bool             `json:"changeBase"`
	Stack         []AdeRebaseStack `json:"stack"`
	Push          bool             `json:"push"`
	Autostash     bool             `json:"autostash"`
	// Review is a review branch the rebase must leave alone (Queue after).
	Review string `json:"review,omitempty"`
}

// AdeRebaseStack is one branch of a rebase run, root first. ParentRef is the ref it goes onto;
// ParentBefore is the parent's tip before the run ("" for the root).
type AdeRebaseStack struct {
	BranchID     string `json:"branchId"`
	Name         string `json:"name"`
	Worktree     string `json:"worktree"`
	ParentRef    string `json:"parentRef"`
	ParentName   string `json:"parentName"`
	ParentBefore string `json:"parentBefore"`
	Before       string `json:"before"`
}

// AdeRunLaunch is a held run's launch spec: what the run needs once its worktree gate opens. Non-empty
// only on a never-launched row; launch clears it.
type AdeRunLaunch struct {
	// Note stays on the run while it runs.
	Note string
	// ResumeID, when set, continues that Claude session with Prompt as the message.
	ResumeID string
	Prompt   string
	// Extra is added after a fresh run's composed prompt.
	Extra string
}

// AdeRunState* mirror ade_runs.state's CHECK.
const (
	AdeRunPending = "pending"
	AdeRunRunning = "running"
	AdeRunStuck   = "stuck"
	AdeRunFailed  = "failed"
	AdeRunBack    = "back"
	AdeRunDone    = "done"
)

// AdeRunPatch holds only the run leaves the caller changes; nil = unchanged.
type AdeRunPatch struct {
	State      *string
	Note       *string
	Summary    *string
	SessionID  *string
	ExitCode   *int
	StartedAt  *int64
	FinishedAt *int64
	Outcome    *AdeRunOutcome
	Launch     *AdeRunLaunch
}

// AdeWorktreeSetup is one row of ade_worktree_setup.
type AdeWorktreeSetup struct {
	BranchID   string
	State      string
	StartedAt  int64
	FinishedAt *int64
	ExitCode   *int
	// Note is why the setup failed ("" otherwise).
	Note string
}

// AdeBacklogItem is one row of ade_backlog.
type AdeBacklogItem struct {
	ID        string
	Text      string
	Position  int
	JiraKey   string
	JiraURL   string
	GithubURL string
	Notes     string
	AddedAt   int64
}

// Validate asserts what the CHECK covers, earlier and with a message.
func (i AdeBacklogItem) Validate() error {
	if i.ID == "" {
		return fmt.Errorf("model: ade backlog item: id is required")
	}
	if i.Text == "" {
		return fmt.Errorf("model: ade backlog item %q: text is required", i.ID)
	}
	return nil
}

// AdeBacklogPatch holds only the leaves the caller changes; nil = unchanged.
type AdeBacklogPatch struct {
	Text      *string
	JiraKey   *string
	JiraURL   *string
	GithubURL *string
	Notes     *string
}

// AdeRepoEnv is one row of ade_repo_envs.
type AdeRepoEnv struct {
	Name              string
	DeployedShaScript string
}

// AdeRepoConfig is a code repo joined with its ade config, integration branches and environments.
// A repo with no ade_repo_config row carries the column defaults.
type AdeRepoConfig struct {
	CodeRepoID          string
	RepoID              string // code_repos.repo_id: the git_repo_settings key
	Name                string
	Root                string
	Nickname            string
	Source              string
	IntegrationBranches []string
	Environments        []AdeRepoEnv
}

// AdeFolder is one row of ade_folders plus the number of repos imported from it.
type AdeFolder struct {
	Path      string
	Watch     bool
	Hidden    bool
	RepoCount int
	// HiddenCount is how many of the folder's imported repos are hidden.
	HiddenCount int
}

// AdeRepoConfigPatch holds only the ade_repo_config leaves the caller changes; nil = unchanged.
// Integration branches and environments are dense rewrites. The prepare script and timeout live in
// git_repo_settings, not here.
type AdeRepoConfigPatch struct {
	Nickname            *string
	IntegrationBranches *[]string
	Environments        *[]AdeRepoEnv
}

// AdeBranchMark is the last branch tip seen fully contained in a target (kind 'target') or an
// environment (kind 'env'). Recorded is set only by an explicit RecordMerge.
type AdeBranchMark struct {
	BranchID  string
	Kind      string
	Name      string
	MergedTip string
	Recorded  bool
	UpdatedAt int64
}

// AdeEnvState is one environment's last deploy-script result.
type AdeEnvState struct {
	CodeRepoID string
	Env        string
	Sha        string
	PrevSha    string
	Error      string
	CheckedAt  int64
}

// AdeBranchKind* are ade_task_branches.kind's CHECK values: mine (the local git user's own),
// review (someone else's), parked (set aside by the user).
const (
	AdeBranchKindMine   = "mine"
	AdeBranchKindReview = "review"
	AdeBranchKindParked = "parked"
)

// ValidAdeBranchKind mirrors ade_task_branches.kind's CHECK constraint.
func ValidAdeBranchKind(v string) bool {
	switch v {
	case AdeBranchKindMine, AdeBranchKindReview, AdeBranchKindParked:
		return true
	default:
		return false
	}
}
