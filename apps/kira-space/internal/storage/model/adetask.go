package model

import "fmt"

// AdeTaskKind* are ade_tasks.kind's CHECK values; AdeBranchKind* (adequeue.go) are the branch kinds.
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
// "" stores NULL.
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
	ID          string
	TaskID      string
	CodeRepoID  string
	Name        string
	Kind        string
	Base        string
	QueuedAfter string
	Position    int
	HadCommits  bool
	AddedAt     int64
	MergedAt    *int64
	ArchivedAt  *int64
}

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

// AdeRun is one row of ade_runs. Todo is nil unless the agent reported progress.
type AdeRun struct {
	ID         string
	TaskID     string
	StageID    string
	StepID     string
	BranchID   string
	Attempt    int
	State      string
	TodoDone   *int
	TodoTotal  *int
	Loops      int
	Note       string
	Summary    string
	SessionID  string
	ExitCode   *int
	StartedAt  *int64
	FinishedAt *int64
}

// AdeWorktreeSetup is one row of ade_worktree_setup.
type AdeWorktreeSetup struct {
	BranchID   string
	State      string
	StartedAt  int64
	FinishedAt *int64
	ExitCode   *int
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
	RepoCount int
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
