// Package adewire holds the ADE v2 wire contract: the JSON shapes of AdeTaskService results,
// arguments and push payloads. Frozen at P143; the TS mirror is frontend/src/ade/v2/wire.ts.
// Every field is always present; nullable is a pointer; slices and maps are never nil.
// Changing a key, type or value set is a contract change.
package adewire

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"

// StageKind is 'user' | 'agent' | 'script'.
type StageKind = string

// TaskStatus is 'To do' | 'In progress' | 'In review' | 'Done'.
type TaskStatus = string

// RunsOn is 'once' | 'each repo' | `only ${string}`.
type RunsOn = string

// OnFailure is 'stop' | 'retry 1' | 'retry 2' | `back:${string}`.
type OnFailure = string

// RunState is 'pending' | 'running' | 'stuck' | 'failed' | 'back' | 'done'.
type RunState = string

// LogKind is 'run' | 'setup'.
type LogKind = string

type Jira struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

type FileChange struct {
	Path    string `json:"path"`
	Added   *int   `json:"added"`
	Deleted *int   `json:"deleted"`
	Binary  bool   `json:"binary"`
}

type Commit struct {
	Sha     string `json:"sha"`
	Message string `json:"message"`
}

type DirtyEntry struct {
	Code string `json:"code"`
	Path string `json:"path"`
}

type RemoteOpError struct {
	Kind          string  `json:"kind"`
	Message       string  `json:"message"`
	RemoteMessage *string `json:"remoteMessage"`
}

type Environment struct {
	Name              string `json:"name"`
	DeployedShaScript string `json:"deployedShaScript"`
}

type Repo struct {
	CodeRepoID          string        `json:"codeRepoId"`
	Name                string        `json:"name"`
	Nickname            string        `json:"nickname"`
	Path                string        `json:"path"`
	Source              string        `json:"source"`
	UsedByTasks         bool          `json:"usedByTasks"`
	IntegrationBranches []string      `json:"integrationBranches"`
	PrepareScript       string        `json:"prepareScript"`
	PrepareTimeout      string        `json:"prepareTimeout"`
	WorktreeBasePath    string        `json:"worktreeBasePath"`
	Environments        []Environment `json:"environments"`
}

type Folder struct {
	Path      string `json:"path"`
	Watch     bool   `json:"watch"`
	RepoCount int    `json:"repoCount"`
}

type ReposResult struct {
	Repos   []Repo   `json:"repos"`
	Folders []Folder `json:"folders"`
}

type FolderImportResult struct {
	Folder   Folder   `json:"folder"`
	Imported []string `json:"imported"`
}

type PipelineStep struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	RunsOn       RunsOn    `json:"runsOn"`
	Before       string    `json:"before"` // 'auto' | 'approval'
	OnFailure    OnFailure `json:"onFailure"`
	Timeout      string    `json:"timeout"`
	Prompt       string    `json:"prompt"`
	AllowedTools []string  `json:"allowedTools"`
}

type Stage struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Kind      StageKind      `json:"kind"`
	Status    TaskStatus     `json:"status"`
	Skip      bool           `json:"skip"`
	Session   bool           `json:"session"`
	Prompt    string         `json:"prompt"`
	Steps     []PipelineStep `json:"steps"`
	Command   string         `json:"command"`
	RunsOn    string         `json:"runsOn"`    // RunsOn | ''
	OnFailure string         `json:"onFailure"` // OnFailure | ''
	Timeout   string         `json:"timeout"`
}

type Workflow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// KiraSpaceMcp turns on the Kira Space tools (declare repos, request branches) for the work of a task.
	KiraSpaceMcp bool    `json:"kiraSpaceMcp"`
	Stages       []Stage `json:"stages"`
}

type WorkflowError struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

type WorkflowEntry struct {
	FileName string         `json:"fileName"`
	Path     string         `json:"path"`
	Workflow *Workflow      `json:"workflow"`
	Error    *WorkflowError `json:"error"`
	UsedBy   int            `json:"usedBy"`
}

type WorkflowsResult struct {
	Dir       string          `json:"dir"`
	Workflows []WorkflowEntry `json:"workflows"`
}

type WorkflowYaml struct {
	FileName string `json:"fileName"`
	Path     string `json:"path"`
	Yaml     string `json:"yaml"`
}

type WorkflowValidation struct {
	Workflow *Workflow      `json:"workflow"`
	Error    *WorkflowError `json:"error"`
}

type WorktreeSetup struct {
	State      string `json:"state"` // 'running' | 'ready' | 'failed'
	StartedAt  int64  `json:"startedAt"`
	FinishedAt *int64 `json:"finishedAt"`
	ExitCode   *int   `json:"exitCode"`
	Note       string `json:"note"` // why it failed, '' otherwise
}

type Deployment struct {
	Env            string `json:"env"`
	DeployedSha    string `json:"deployedSha"`
	CheckedAt      int64  `json:"checkedAt"`
	Status         string `json:"status"` // 'deployed' | 'stale' | 'not deployed' | 'unknown'
	MissingCommits int    `json:"missingCommits"`
	Note           string `json:"note"`
	Error          string `json:"error"`
}

type Integration struct {
	Target   string `json:"target"`
	Status   string `json:"status"` // 'merged' | 'stale' | 'not merged'
	Note     string `json:"note"`
	Recorded bool   `json:"recorded"`
}

type PR struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	State  string `json:"state"`
	URL    string `json:"url"`
}

type Branch struct {
	ID                  string         `json:"id"`
	TaskID              string         `json:"taskId"`
	CodeRepoID          string         `json:"codeRepoId"`
	Name                string         `json:"name"`
	Kind                string         `json:"kind"` // 'mine' | 'review' | 'parked'
	Owner               string         `json:"owner"`
	Base                string         `json:"base"`
	BaseBranchID        string         `json:"baseBranchId"`
	BaseOwner           string         `json:"baseOwner"`
	BaseMissing         bool           `json:"baseMissing"`
	BasePendingFrom     string         `json:"basePendingFrom"`
	RebaseInProgress    bool           `json:"rebaseInProgress"`
	Tip                 string         `json:"tip"`
	Ahead               int            `json:"ahead"`
	Behind              int            `json:"behind"`
	Upstream            string         `json:"upstream"`
	UpstreamAhead       int            `json:"upstreamAhead"`
	UpstreamBehind      int            `json:"upstreamBehind"`
	MergedIntoMain      bool           `json:"mergedIntoMain"`
	MergedAt            *int64         `json:"mergedAt"`
	Worktree            string         `json:"worktree"`
	Setup               *WorktreeSetup `json:"setup"`
	Integration         []Integration  `json:"integration"`
	Deployments         []Deployment   `json:"deployments"`
	ConflictsIfRebased  []string       `json:"conflictsIfRebased"`
	ConflictCheck       string         `json:"conflictCheck"`       // 'checking' | 'done' | 'failed'
	ConflictCheckReason string         `json:"conflictCheckReason"` // '' unless failed
	Files               []FileChange   `json:"files"`
	Commits             []Commit       `json:"commits"`
	CommitCount         int            `json:"commitCount"`
	Dirty               []DirtyEntry   `json:"dirty"`
	LastCommitAt        *int64         `json:"lastCommitAt"`
	AddedAt             int64          `json:"addedAt"`
	Origin              string         `json:"origin"` // '' user | 'agent'
}

type Pair struct {
	A         string   `json:"a"`
	B         string   `json:"b"`
	Shared    []string `json:"shared"`
	Conflicts []string `json:"conflicts"`
}

type Run struct {
	ID         string   `json:"id"`
	TaskID     string   `json:"taskId"`
	StageID    string   `json:"stageId"`
	StepID     string   `json:"stepId"`
	BranchID   string   `json:"branchId"`
	Attempt    int      `json:"attempt"`
	State      RunState `json:"state"`
	Loops      int      `json:"loops"`
	Note       string   `json:"note"`
	Summary    string   `json:"summary"`
	SessionID  string   `json:"sessionId"`
	ExitCode   *int     `json:"exitCode"`
	StartedAt  *int64   `json:"startedAt"`
	FinishedAt *int64   `json:"finishedAt"`
	Purpose    string   `json:"purpose"` // '' step run | 'rebase'

	Outcome *model.AdeRunOutcome `json:"outcome"`
}

type Task struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"` // 'task' | 'review' | 'parked'
	Title        string `json:"title"`
	Owner        string `json:"owner"`
	Jira         *Jira  `json:"jira"`
	GithubURL    string `json:"githubUrl"`
	WorkflowID   string `json:"workflowId"`
	StageID      string `json:"stageId"`
	CurrentStage *Stage `json:"currentStage"`
	// Workflow is the version a started task runs; nil until it starts. WorkflowOutdated: the live
	// file differs from it.
	Workflow         *Workflow `json:"workflow"`
	WorkflowOutdated bool      `json:"workflowOutdated"`
	Est              string    `json:"est"`
	Notes            string    `json:"notes"`
	Color            int       `json:"color"`
	BranchIDs        []string  `json:"branchIds"`
	Runs             []Run     `json:"runs"`
	CreatedAt        int64     `json:"createdAt"`
}

type Plan struct {
	Day         map[string]string `json:"day"`
	Order       []string          `json:"order"`
	QueuedAfter map[string]string `json:"queuedAfter"`
	Unpushed    map[string]bool   `json:"unpushed"`
}

type HistoryEntry struct {
	TaskID      string   `json:"taskId"`
	Title       string   `json:"title"`
	CodeRepoIDs []string `json:"codeRepoIds"`
	MergedAt    *int64   `json:"mergedAt"`
	ArchivedAt  int64    `json:"archivedAt"`
}

type RepoState struct {
	CodeRepoID  string `json:"codeRepoId"`
	MainName    string `json:"mainName"`
	Remote      string `json:"remote"`
	LastFetchAt *int64 `json:"lastFetchAt"`
}

type Board struct {
	Tasks            []Task         `json:"tasks"`
	Branches         []Branch       `json:"branches"`
	Plan             Plan           `json:"plan"`
	Pairs            []Pair         `json:"pairs"`
	History          []HistoryEntry `json:"history"`
	Repos            []RepoState    `json:"repos"`
	WorktreeBasePath string         `json:"worktreeBasePath"`
	AutofetchMinutes int            `json:"autofetchMinutes"`
}

type RepoPrs struct {
	CodeRepoID string `json:"codeRepoId"`
	Kind       string `json:"kind"` // 'ok' | 'disabled' | 'unavailable'
	WebURL     string `json:"webUrl"`
}

type PrsResult struct {
	Repos    []RepoPrs     `json:"repos"`
	Branches map[string]PR `json:"branches"`
}

type BacklogItem struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	AddedAt   int64  `json:"addedAt"`
	Jira      *Jira  `json:"jira"`
	GithubURL string `json:"githubUrl"`
	Notes     string `json:"notes"`
}

type BacklogResult struct {
	Items []BacklogItem `json:"items"`
}

type CandidateBranch struct {
	CodeRepoID   string `json:"codeRepoId"`
	Name         string `json:"name"`
	Author       string `json:"author"`
	LastCommitAt int64  `json:"lastCommitAt"`
	RemoteOnly   bool   `json:"remoteOnly"`
	Mine         bool   `json:"mine"`
}

type CandidateBranchesResult struct {
	Branches []CandidateBranch `json:"branches"`
}

type AddExistingBranchResult struct {
	Task   Task   `json:"task"`
	Branch Branch `json:"branch"`
}

type MergedInto struct {
	BranchID string `json:"branchId"`
	Target   string `json:"target"`
}

type RepoRefresh struct {
	CodeRepoID  string         `json:"codeRepoId"`
	RefsChanged int            `json:"refsChanged"`
	MergedInto  []MergedInto   `json:"mergedInto"`
	Error       *RemoteOpError `json:"error"`
}

type RefreshResult struct {
	Repos []RepoRefresh `json:"repos"`
}

type ForcePushResult struct {
	BranchID string         `json:"branchId"`
	Error    *RemoteOpError `json:"error"`
}

type BranchRisk struct {
	BranchID string       `json:"branchId"`
	Worktree string       `json:"worktree"`
	Dirty    []DirtyEntry `json:"dirty"`
	Unmerged int          `json:"unmerged"`
	Blocked  string       `json:"blocked"`
}

type ArchiveRisk struct {
	TaskID   string       `json:"taskId"`
	Branches []BranchRisk `json:"branches"`
}

type StartRunResult struct {
	RunIDs []string `json:"runIds"`
}

type LogChunk struct {
	Seq    int    `json:"seq"`
	At     int64  `json:"at"`
	Stream string `json:"stream"` // 'stdout' | 'stderr' | 'event'
	Text   string `json:"text"`
}

type LogPage struct {
	Kind      LogKind    `json:"kind"`
	ID        string     `json:"id"`
	Chunks    []LogChunk `json:"chunks"`
	NextSeq   int        `json:"nextSeq"`
	Done      bool       `json:"done"`
	Truncated bool       `json:"truncated"`
}

type Session struct {
	ID              string `json:"id"`
	ClaudeSessionID string `json:"claudeSessionId"`
	Mode            string `json:"mode"`     // 'tui' | 'headless'
	State           string `json:"state"`    // 'running' | 'stopped'
	Activity        string `json:"activity"` // '' | 'input' | 'working' | 'waiting' | 'idle'
	TerminalID      string `json:"terminalId"`
	TaskID          string `json:"taskId"`
	BranchID        string `json:"branchId"`
	StageID         string `json:"stageId"`
	StepID          string `json:"stepId"`
	RunID           string `json:"runId"`
	Resumes         string `json:"resumes"`
	Purpose         string `json:"purpose"` // '' | 'review'
	Cwd             string `json:"cwd"`
	CwdMissing      bool   `json:"cwdMissing"`
	StartedAt       int64  `json:"startedAt"`
	LastActiveAt    int64  `json:"lastActiveAt"`
}

type SessionsResult struct {
	Sessions []Session `json:"sessions"`
}

type Launch struct {
	TerminalID string `json:"terminalId"`
	SessionID  string `json:"sessionId"`
	Command    string `json:"command"`
	Cwd        string `json:"cwd"`
}

type RunsChangedEvent struct {
	Runs []Run `json:"runs"`
}

type LogEvent struct {
	Kind   LogKind    `json:"kind"`
	ID     string     `json:"id"`
	Chunks []LogChunk `json:"chunks"`
}

type OpenSessionEvent struct {
	TaskID    string `json:"taskId"`
	BranchID  string `json:"branchId"`
	SessionID string `json:"sessionId"`
}

type CreateTaskArgs struct {
	Title       string   `json:"title"`
	Jira        *Jira    `json:"jira"`
	GithubURL   string   `json:"githubUrl"`
	Notes       string   `json:"notes"`
	CodeRepoIDs []string `json:"codeRepoIds"`
	WorkflowID  string   `json:"workflowId"`
	// Bases maps a code repo id to the base of its branch; a missing repo starts from main.
	Bases map[string]BaseChoice `json:"bases"`
}

type TaskPatch struct {
	Title     *string `json:"title"`
	Jira      *Jira   `json:"jira"`
	ClearJira bool    `json:"clearJira"`
	GithubURL *string `json:"githubUrl"`
	Est       *string `json:"est"`
	Notes     *string `json:"notes"`
	Color     *int    `json:"color"`
	Kind      *string `json:"kind"` // 'task' | 'parked'
}

type UpdateTaskArgs struct {
	TaskID string    `json:"taskId"`
	Patch  TaskPatch `json:"patch"`
}

type AddTaskRepoArgs struct {
	TaskID     string      `json:"taskId"`
	CodeRepoID string      `json:"codeRepoId"`
	Base       *BaseChoice `json:"base"`
}

type AddExistingBranchArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Name       string `json:"name"`
	TaskID     string `json:"taskId"`
}

type SetPlanArgs struct {
	Order []string           `json:"order"`
	Days  map[string]*string `json:"days"`
}

type SetQueuedAfterArgs struct {
	BranchID      string `json:"branchId"`
	AfterBranchID string `json:"afterBranchId"`
}

type RefreshArgs struct {
	CodeRepoIDs []string `json:"codeRepoIds"`
}

type BranchArgs struct {
	BranchID string `json:"branchId"`
}

type AddBacklogItemArgs struct {
	Text string `json:"text"`
}

type BacklogPatch struct {
	Text      *string `json:"text"`
	Jira      *Jira   `json:"jira"`
	ClearJira bool    `json:"clearJira"`
	GithubURL *string `json:"githubUrl"`
	Notes     *string `json:"notes"`
}

type UpdateBacklogItemArgs struct {
	ID    string       `json:"id"`
	Patch BacklogPatch `json:"patch"`
}

type BacklogItemArgs struct {
	ID string `json:"id"`
}

type MoveBacklogItemArgs struct {
	ID      string `json:"id"`
	ToIndex int    `json:"toIndex"`
}

type FileNameArgs struct {
	FileName string `json:"fileName"`
}

type SaveWorkflowArgs struct {
	FileName string   `json:"fileName"`
	Workflow Workflow `json:"workflow"`
}

type SaveWorkflowYamlArgs struct {
	FileName string `json:"fileName"`
	Yaml     string `json:"yaml"`
}

type ValidateWorkflowYamlArgs struct {
	Yaml string `json:"yaml"`
}

type ImportWorkflowArgs struct {
	Path string `json:"path"`
}

type NewWorkflowArgs struct {
	Name string `json:"name"`
}

type RepoPatch struct {
	Nickname            *string        `json:"nickname"`
	IntegrationBranches *[]string      `json:"integrationBranches"`
	PrepareScript       *string        `json:"prepareScript"`
	PrepareTimeout      *string        `json:"prepareTimeout"`
	WorktreeBasePath    *string        `json:"worktreeBasePath"`
	Environments        *[]Environment `json:"environments"`
}

type UpdateRepoArgs struct {
	CodeRepoID string    `json:"codeRepoId"`
	Patch      RepoPatch `json:"patch"`
}

type FolderArgs struct {
	Path  string `json:"path"`
	Watch bool   `json:"watch"`
}

type PathArgs struct {
	Path string `json:"path"`
}

type RecordMergeArgs struct {
	BranchID string `json:"branchId"`
	Target   string `json:"target"`
}

// StartRunArgs.BranchNames: branchId -> name; "" = derived from the task title.
type StartRunArgs struct {
	TaskID      string            `json:"taskId"`
	BranchNames map[string]string `json:"branchNames"`
	Message     string            `json:"message"`
	// FromStageID, when set, is the stage the caller saw; the engine refuses with ErrStale when the
	// task has moved on. Desktop leaves it empty.
	FromStageID string `json:"fromStageId,omitempty"`
}

type StepArgs struct {
	TaskID  string `json:"taskId"`
	StageID string `json:"stageId"`
	StepID  string `json:"stepId"`
}

type RunArgs struct {
	RunID string `json:"runId"`
}

type TaskArgs struct {
	TaskID string `json:"taskId"`
}

type WindowKeyArgs struct {
	WindowKey string `json:"windowKey"`
}

// ReviewWindowTarget is what a review window reviews (P150).
type ReviewWindowTarget struct {
	TaskID     string `json:"taskId"`
	BranchID   string `json:"branchId"`
	CodeRepoID string `json:"codeRepoId"`
	GitRepoID  string `json:"gitRepoId"`
	Branch     string `json:"branch"`
	Base       string `json:"base"`
	Worktree   string `json:"worktree"`
}

// ReviewAgentState is the task's review agent row; HostWindowKey is ” unless it runs.
type ReviewAgentState struct {
	Session       *Session `json:"session"`
	HostWindowKey string   `json:"hostWindowKey"`
}

// ReviewAgentLaunch carries Note when a fresh conversation replaced a resume.
type ReviewAgentLaunch struct {
	Launch  Launch `json:"launch"`
	Resumed bool   `json:"resumed"`
	Note    string `json:"note"`
}

// GhSyncStatus: 'ok' | 'noPr' | 'prClosed' | 'disabled' | 'ghMissing' | 'unauthenticated' |
// 'unavailable' | 'headNotFetched'.
type GhSyncStatus string

type GhSyncFile struct {
	Path   string `json:"path"`
	Action string `json:"action"` // 'mark' | 'unmark' | 'alreadyViewed' | 'skip'
	Reason string `json:"reason"` // '' | 'notReviewed' | 'partial' | 'changedSinceReview' | 'differsFromPrHead' | 'notInPr'
}

type GhSyncPlan struct {
	Status   GhSyncStatus `json:"status"`
	Message  string       `json:"message"`
	Account  string       `json:"account"`
	Pr       *PR          `json:"pr"`
	HeadSha  string       `json:"headSha"`
	LocalTip string       `json:"localTip"`
	Files    []GhSyncFile `json:"files"`
}

type GhSyncFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type GhSyncResult struct {
	Status   GhSyncStatus    `json:"status"`
	Message  string          `json:"message"`
	Marked   []string        `json:"marked"`
	Unmarked []string        `json:"unmarked"`
	Failed   []GhSyncFailure `json:"failed"`
}

type ReadLogArgs struct {
	Kind     LogKind `json:"kind"`
	ID       string  `json:"id"`
	AfterSeq int     `json:"afterSeq"`
}

type TakeOverArgs struct {
	SessionID     string `json:"sessionId"`
	StopIfRunning bool   `json:"stopIfRunning"`
}

type LaunchStageArgs struct {
	TaskID  string `json:"taskId"`
	Message string `json:"message"`
	// FromStageID, when set, is the stage the caller saw; the engine refuses with ErrStale when the
	// task has moved on. Desktop leaves it empty.
	FromStageID string `json:"fromStageId,omitempty"`
}

type StartBranchArgs struct {
	BranchID string `json:"branchId"`
	Message  string `json:"message"`
}

type SetTaskWorkflowArgs struct {
	TaskID     string `json:"taskId"`
	WorkflowID string `json:"workflowId"`
}

type SetTaskStageArgs struct {
	TaskID  string `json:"taskId"`
	StageID string `json:"stageId"`
	// FromStageID, when set, is the stage the caller saw; the engine refuses with ErrStale when the
	// task has moved on. Desktop leaves it empty.
	FromStageID string `json:"fromStageId,omitempty"`
}

type SendArgs struct {
	SessionID string `json:"sessionId"`
	Message   string `json:"message"`
}

type FocusSessionArgs struct {
	SessionID string `json:"sessionId"`
	TaskID    string `json:"taskId"`
}

// BaseChoice names a base: a planner branch (BranchID), a git ref (Ref) or, with both empty, the
// repo's main.
type BaseChoice struct {
	Ref      string `json:"ref"`
	BranchID string `json:"branchId"`
}

type SetBranchBaseArgs struct {
	BranchID string     `json:"branchId"`
	Base     BaseChoice `json:"base"`
}

// OntoArgs names a rebase: BranchID and the branches stacked on it go onto Onto (nil = their
// current base), or onto the review branch QueueWith, which then also becomes their queue parent.
type OntoArgs struct {
	BranchID  string      `json:"branchId"`
	Onto      *BaseChoice `json:"onto"`
	QueueWith string      `json:"queueWith"`
	Push      bool        `json:"push"`
	Autostash bool        `json:"autostash"`
}

// RebaseArgs starts the rebase; Message ” = the default prompt.
type RebaseArgs struct {
	BranchID  string      `json:"branchId"`
	Onto      *BaseChoice `json:"onto"`
	QueueWith string      `json:"queueWith"`
	Push      bool        `json:"push"`
	Autostash bool        `json:"autostash"`
	Message   string      `json:"message"`
}

type RebaseStackItem struct {
	BranchID string `json:"branchId"`
	Name     string `json:"name"`
	Worktree string `json:"worktree"`
	OntoRef  string `json:"ontoRef"`
}

// RebaseBlocker kinds: dirty, running, inProgress, baseMissing, parentDraft, noWorktree, setup.
type RebaseBlocker struct {
	BranchID string `json:"branchId"`
	Kind     string `json:"kind"`
	Text     string `json:"text"`
}

type RebasePreview struct {
	Prompt   string            `json:"prompt"`
	Suffix   string            `json:"suffix"`
	Stack    []RebaseStackItem `json:"stack"`
	Blockers []RebaseBlocker   `json:"blockers"`
	NoOp     bool              `json:"noOp"`
}

type RebaseStart struct {
	RunID string `json:"runId"`
	NoOp  bool   `json:"noOp"`
}

type RepoBranchesArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	BranchID   string `json:"branchId"`
}

// BasePick is one base the picker offers; Excluded is why it cannot be chosen (” = choosable).
type BasePick struct {
	Name      string `json:"name"`
	Local     bool   `json:"local"`
	Remote    bool   `json:"remote"`
	BranchID  string `json:"branchId"`
	TaskID    string `json:"taskId"`
	TaskTitle string `json:"taskTitle"`
	Draft     bool   `json:"draft"`
	Excluded  string `json:"excluded"`
}

type RepoBranches struct {
	MainName string     `json:"mainName"`
	Previous string     `json:"previous"`
	Branches []BasePick `json:"branches"`
}
