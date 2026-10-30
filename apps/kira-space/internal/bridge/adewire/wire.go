// Package adewire holds the ADE v2 wire contract: the JSON shapes of AdeTaskService results,
// arguments and push payloads. The TS mirror is frontend/src/ade/v2/wire.ts.
// Every field is always present; nullable is a pointer; slices and maps are never nil.
// Changing a key, type or value set is a contract change.
package adewire

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// StepKind is 'agent' | 'script' | 'review' | 'manual'.
type StepKind = string

// Step kinds.
const (
	KindAgent  StepKind = "agent"
	KindScript StepKind = "script"
	KindReview StepKind = "review"
	KindManual StepKind = "manual"
)

// TaskStatus is a task status id from the user's status set, such as 'in-progress'.
type TaskStatus = string

// RunsOn is 'once' | 'each repo' | `only ${string}`.
type RunsOn = string

// RunState is 'pending' | 'running' | 'stuck' | 'failed' | 'back' | 'done' | 'review'.
type RunState = string

// LogKind is 'run' | 'setup'.
type LogKind = string

type Jira struct {
	Key string `json:"key"`
	URL string `json:"url"`
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
	Path        string `json:"path"`
	Watch       bool   `json:"watch"`
	Hidden      bool   `json:"hidden"`
	RepoCount   int    `json:"repoCount"`
	HiddenCount int    `json:"hiddenCount"`
}

type ReposResult struct {
	Repos   []Repo   `json:"repos"`
	Folders []Folder `json:"folders"`
}

type FolderImportResult struct {
	Folder   Folder   `json:"folder"`
	Imported []string `json:"imported"`
}

// StepResult is one result a step may report through finish_step. Next is RouteNext, RouteEnd,
// RouteStop or a step id of the workflow; Loop says the route goes back to the step or an earlier one
// (a return, counted against the step's MaxReturns).
type StepResult struct {
	ID          string `json:"id"`
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Next        string `json:"next"`
	Loop        bool   `json:"loop"`
}

// WorkflowStep is one step of a workflow. Fields of another kind than Kind hold their zero value.
type WorkflowStep struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Kind    StepKind     `json:"kind"`
	Status  TaskStatus   `json:"status"`
	Skip    bool         `json:"skip"`
	Session bool         `json:"session"` // manual: open a Claude Code session
	Command string       `json:"command"` // script
	RunsOn  RunsOn       `json:"runsOn"`  // agent, script, review
	Before  string       `json:"before"`  // 'auto' | 'approval'
	Results []StepResult `json:"results"`
	// MaxReturns is how many times a result may send the run back to this step or an earlier one before
	// the run stops; 0 is no limit (review steps only).
	MaxReturns   int      `json:"maxReturns"`
	Timeout      string   `json:"timeout"`
	Prompt       string   `json:"prompt"` // agent prompt; manual: first session message
	AllowedTools []string `json:"allowedTools"`
	// SmartScript runs the named smart script instead of Prompt; Params are its values per param name.
	SmartScript string              `json:"smartScript"`
	Params      map[string][]string `json:"params"`
	// Review is set on review steps: they wait for the user instead of running an agent.
	Review *ReviewStepConfig `json:"review"`
	// Sandbox is what the step's agent may do on the machine; always set, the default when absent.
	Sandbox StepSandbox `json:"sandbox"`
}

// Sandbox access levels.
const (
	SandboxWrite = "write"
	SandboxRead  = "read"
	SandboxOff   = "off"
)

// StepSandbox is a step's agent policy. Read are extra read-only folders, Allow extra read-write
// paths; both are absolute or start with "~/".
type StepSandbox struct {
	Access  string   `json:"access"`
	Read    []string `json:"read"`
	Allow   []string `json:"allow"`
	Network bool     `json:"network"`
}

// DefaultSandbox is the policy of a step without a sandbox block: write its worktree, network on.
func DefaultSandbox() StepSandbox {
	return StepSandbox{Access: SandboxWrite, Read: []string{}, Allow: []string{}, Network: true}
}

// Normalized fills the default into a zero value (a snapshot from before the field existed).
func (s StepSandbox) Normalized() StepSandbox {
	if s.Access == "" {
		return DefaultSandbox()
	}
	if s.Read == nil {
		s.Read = []string{}
	}
	if s.Allow == nil {
		s.Allow = []string{}
	}
	return s
}

// IsDefault reports whether s equals the default policy.
func (s StepSandbox) IsDefault() bool {
	s = s.Normalized()
	return s.Access == SandboxWrite && len(s.Read) == 0 && len(s.Allow) == 0 && s.Network
}

// Review step routes.
const (
	ReviewSendImplementer = "implementer"
	ReviewSendNew         = "new"
)

// ReviewStepConfig is a review step's own block. Implementer names an earlier prompt step of the
// workflow whose session takes the comments; "" = the nearest earlier one.
type ReviewStepConfig struct {
	SendTo      string `json:"sendTo"` // ReviewSendImplementer | ReviewSendNew
	Implementer string `json:"implementer"`
}

type Workflow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// KiraSpaceMcp turns on the Kira Space tools (declare repos, request branches) for the work of a task.
	KiraSpaceMcp bool           `json:"kiraSpaceMcp"`
	Steps        []WorkflowStep `json:"steps"`
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
	// Hash identifies the file's current text; Save refuses a draft built on another one.
	Hash string `json:"hash"`
}

type WorkflowsResult struct {
	Dir       string          `json:"dir"`
	Workflows []WorkflowEntry `json:"workflows"`
	// Sandbox says whether step sandboxes are enforced on this OS.
	Sandbox SandboxSupport `json:"sandbox"`
}

type WorkflowYaml struct {
	FileName string `json:"fileName"`
	Path     string `json:"path"`
	Yaml     string `json:"yaml"`
	// Hash identifies Yaml; SaveWorkflowYamlArgs.BaseHash sends it back.
	Hash string `json:"hash"`
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

// ChangeRequest is a pull or merge request; the repo's Info names it in the host's wording.
type ChangeRequest struct {
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
	// Returns is how many times this branch's step went back up to and including this attempt.
	Returns int `json:"returns"`
	// Resumable says a restart stopped the run mid-session; ResumeRun continues it.
	Resumable bool `json:"resumable"`
	// Review is set on a review step run only.
	Review *RunReview `json:"review"`
	// Sandbox is the badge of a headless run's sandbox; null when the run had none.
	Sandbox *RunSandboxBadge `json:"sandbox"`

	Outcome *model.AdeRunOutcome `json:"outcome"`
}

// RunSandboxBadge summarises a run's sandbox for the run line.
type RunSandboxBadge struct {
	Access   string `json:"access"`
	Enforced bool   `json:"enforced"`
	Denials  int    `json:"denials"`
	// Last is the last kept denial as "op target"; "" when none.
	Last string `json:"last"`
}

// SandboxSupport says whether this OS enforces step sandboxes; Reason is the notice when it does not.
type SandboxSupport struct {
	Enforced bool   `json:"enforced"`
	Reason   string `json:"reason"`
}

// SandboxDenial is one operation the sandbox blocked.
type SandboxDenial struct {
	At      int64  `json:"at"`
	Op      string `json:"op"`
	Target  string `json:"target"`
	Process string `json:"process"`
}

// RunSandboxDetail is everything the sandbox popover and profile dialog show for a run.
type RunSandboxDetail struct {
	Access   string   `json:"access"`
	Enforced bool     `json:"enforced"`
	Reason   string   `json:"reason"`
	Write    []string `json:"write"`
	Read     []string `json:"read"`
	Allow    []string `json:"allow"`
	Network  bool     `json:"network"`
	Profile  string   `json:"profile"`
	// Denials are the first distinct denials; DenialCount counts every one.
	Denials     []SandboxDenial `json:"denials"`
	DenialCount int             `json:"denialCount"`
}

// Review phases of RunReview.Phase.
const (
	ReviewPhaseWaiting = "waiting"
	ReviewPhaseSent    = "sent"
	ReviewPhaseWorking = "working"
	ReviewPhaseStuck   = "stuck"
	ReviewPhaseDone    = "done"
)

// RunReview is where a review step run stands: waiting, a round pending/working/stuck, or finished.
type RunReview struct {
	Phase string `json:"phase"`
	Round int    `json:"round"`
	Route string `json:"route"`
	Note  string `json:"note"`
}

// ReviewCandidate is an agent run that can take the review comments.
type ReviewCandidate struct {
	RunID      string `json:"runId"`
	Step       string `json:"step"`
	Attempt    int    `json:"attempt"`
	FinishedAt *int64 `json:"finishedAt"`
}

// ReviewRound is the latest send of a review run.
type ReviewRound struct {
	Run      Run    `json:"run"`
	N        int    `json:"n"`
	Route    string `json:"route"`
	Fallback bool   `json:"fallback"`
	// Commits counts the commits the round added; nil when unknown or not finished.
	Commits *int `json:"commits"`
}

// ReviewStepState is a branch's review step for the review window; Run nil = no review step there.
type ReviewStepState struct {
	Run                *Run              `json:"run"`
	StepName           string            `json:"stepName"`
	Results            []StepResult      `json:"results"`
	Route              string            `json:"route"`
	TargetRunID        string            `json:"targetRunId"`
	DefaultTargetRunID string            `json:"defaultTargetRunId"`
	Candidates         []ReviewCandidate `json:"candidates"`
	Round              *ReviewRound      `json:"round"`
}

type SendReviewArgs struct {
	RunID       string `json:"runId"`
	Route       string `json:"route"`
	TargetRunID string `json:"targetRunId"`
}

type FinishReviewArgs struct {
	RunID  string `json:"runId"`
	Result string `json:"result"`
	Note   string `json:"note"`
}

// ReviewEvent is the payload of ChannelReview.
type ReviewEvent struct {
	TaskID   string `json:"taskId"`
	BranchID string `json:"branchId"`
}

type Task struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // 'task' | 'review' | 'parked'
	Title   string `json:"title"`
	Owner   string `json:"owner"`
	Jira    *Jira  `json:"jira"`
	HostURL string `json:"hostUrl"`
	// HostLink names HostURL when a registered provider recognises it.
	HostLink   *githost.Link `json:"hostLink"`
	WorkflowID string        `json:"workflowId"`
	// EntryStepID is the step the task last entered; 'done' when finished, '' without a workflow.
	EntryStepID string `json:"entryStepId"`
	// Since is the pass watermark: "<stepId>/<branchId>" -> attempt; runs at or below it are history.
	Since map[string]int `json:"since"`
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
	// StatusID is the task's status; StatusBy says who set it last: 'auto' (a step change) or 'user'.
	StatusID string `json:"statusId"`
	StatusBy string `json:"statusBy"`
}

// TaskStatusDef is one status of the user's set. Category is 'todo' | 'active' | 'review' | 'done'
// and decides which status automation picks; Tone is an ADE tone name.
type TaskStatusDef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Tone     string `json:"tone"`
	Category string `json:"category"`
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

// ArchivedTask is everything an archived task kept, read-only. It carries no worktree path.
type ArchivedTask struct {
	Task       Task             `json:"task"`
	ArchivedAt int64            `json:"archivedAt"`
	Statuses   []TaskStatusDef  `json:"statuses"`
	Branches   []ArchivedBranch `json:"branches"`
	Repos      []RepoHost       `json:"repos"`
}

// ArchivedBranch is one branch row of an archived task. Removed marks a row detached before the
// archive. PRSource is "live" (host answered), "archived" (snapshot taken at archive) or "".
type ArchivedBranch struct {
	ID            string            `json:"id"`
	CodeRepoID    string            `json:"codeRepoId"`
	Name          string            `json:"name"`
	Kind          string            `json:"kind"`
	Base          string            `json:"base"`
	Origin        string            `json:"origin"`
	AddedAt       int64             `json:"addedAt"`
	MergedAt      *int64            `json:"mergedAt"`
	ArchivedAt    int64             `json:"archivedAt"`
	Removed       bool              `json:"removed"`
	ChangeRequest *ChangeRequest    `json:"changeRequest"`
	PRSource      string            `json:"prSource"`
	BranchURL     string            `json:"branchUrl"`
	Comments      []ArchivedComment `json:"comments"`
}

// ArchivedComment is a stored review comment, unanchored: the branch tip may be gone.
type ArchivedComment struct {
	Path      string `json:"path"`
	Start     int    `json:"start"`
	End       int    `json:"end"`
	Body      string `json:"body"`
	Kind      string `json:"kind"`
	State     string `json:"state"`
	Reply     string `json:"reply"`
	CreatedAt int64  `json:"createdAt"`
}

type RepoState struct {
	CodeRepoID  string `json:"codeRepoId"`
	MainName    string `json:"mainName"`
	Remote      string `json:"remote"`
	LastFetchAt *int64 `json:"lastFetchAt"`
}

type Board struct {
	Tasks            []Task          `json:"tasks"`
	Statuses         []TaskStatusDef `json:"statuses"`
	Branches         []Branch        `json:"branches"`
	Plan             Plan            `json:"plan"`
	Pairs            []Pair          `json:"pairs"`
	History          []HistoryEntry  `json:"history"`
	Repos            []RepoState     `json:"repos"`
	WorktreeBasePath string          `json:"worktreeBasePath"`
	AutofetchMinutes int             `json:"autofetchMinutes"`
}

type RepoHost struct {
	CodeRepoID string `json:"codeRepoId"`
	Kind       string `json:"kind"` // 'ok' | 'disabled' | 'unavailable'
	// Host is nil when no registered provider matches the repo's remote.
	Host *githost.Info `json:"host"`
}

type ChangeRequestsResult struct {
	Repos    []RepoHost               `json:"repos"`
	Branches map[string]ChangeRequest `json:"branches"`
	// BranchURLs maps a branch id to its web page, for branches whose repo has a host.
	BranchURLs map[string]string `json:"branchUrls"`
}

type BacklogItem struct {
	ID       string        `json:"id"`
	Text     string        `json:"text"`
	AddedAt  int64         `json:"addedAt"`
	Jira     *Jira         `json:"jira"`
	HostURL  string        `json:"hostUrl"`
	HostLink *githost.Link `json:"hostLink"`
	Notes    string        `json:"notes"`
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

// CandidateBranchesArgs scopes the listing to one repo; empty = every repo.
type CandidateBranchesArgs struct {
	CodeRepoID string `json:"codeRepoId"`
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
	ID             string `json:"id"`
	AgentSessionID string `json:"agentSessionId"`
	Provider       string `json:"provider"`
	Mode           string `json:"mode"`     // 'tui' | 'headless'
	State          string `json:"state"`    // 'running' | 'stopped'
	Activity       string `json:"activity"` // '' | 'input' | 'working' | 'waiting' | 'idle'
	TerminalID     string `json:"terminalId"`
	TaskID         string `json:"taskId"`
	BranchID       string `json:"branchId"`
	StepID         string `json:"stepId"`
	RunID          string `json:"runId"`
	Resumes        string `json:"resumes"`
	Purpose        string `json:"purpose"` // '' | 'review'
	Cwd            string `json:"cwd"`
	CwdMissing     bool   `json:"cwdMissing"`
	StartedAt      int64  `json:"startedAt"`
	LastActiveAt   int64  `json:"lastActiveAt"`
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
	HostURL     string   `json:"hostUrl"`
	Notes       string   `json:"notes"`
	CodeRepoIDs []string `json:"codeRepoIds"`
	WorkflowID  string   `json:"workflowId"`
	// Bases maps a code repo id to the base of its branch; a missing repo starts from main.
	Bases map[string]BaseChoice `json:"bases"`
	// Day is the plan day (YYYY-MM-DD) the task lands on; nil lands in Later.
	Day *string `json:"day"`
}

type TaskPatch struct {
	Title     *string `json:"title"`
	Jira      *Jira   `json:"jira"`
	ClearJira bool    `json:"clearJira"`
	HostURL   *string `json:"hostUrl"`
	Est       *string `json:"est"`
	Notes     *string `json:"notes"`
	Color     *int    `json:"color"`
	Kind      *string `json:"kind"` // 'task' | 'parked'
	// StatusID moves the task to that status by hand.
	StatusID *string `json:"statusId"`
}

// SaveStatusesArgs rewrites the status set in order. A status with an empty ID is new. Reassign maps a
// removed status id to the id its tasks move to; a removed id without an entry goes to the first kept
// status of its category.
type SaveStatusesArgs struct {
	Statuses []TaskStatusDef   `json:"statuses"`
	Reassign map[string]string `json:"reassign"`
}

type SaveStatusesResult struct {
	Statuses []TaskStatusDef `json:"statuses"`
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

// SetTaskBranchArgs names the branch a task row takes: an existing git branch, or a new name to create.
type SetTaskBranchArgs struct {
	BranchID string `json:"branchId"`
	Name     string `json:"name"`
	Existing bool   `json:"existing"`
	// DiscardChanges confirms deleting uncommitted changes in the row's current worktree.
	DiscardChanges bool `json:"discardChanges"`
}

// RemoveTaskRowArgs detaches a task row; DiscardChanges confirms deleting uncommitted changes in its worktree.
type RemoveTaskRowArgs struct {
	BranchID       string `json:"branchId"`
	DiscardChanges bool   `json:"discardChanges"`
}

// UpdateTaskRepoArgs swaps the repo of a row whose branch is not created.
type UpdateTaskRepoArgs struct {
	BranchID   string `json:"branchId"`
	CodeRepoID string `json:"codeRepoId"`
}

type AddExistingBranchArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Name       string `json:"name"`
	TaskID     string `json:"taskId"`
}

type HostLinkArgs struct {
	URL    string `json:"url"`
	TaskID string `json:"taskId"` // '' = new task; ResolveHostLink ignores it
}

// HostLinkTarget is the branch a pasted link names, before anything is fetched.
type HostLinkTarget struct {
	CodeRepoID    string         `json:"codeRepoId"`
	Remote        string         `json:"remote"`
	Branch        string         `json:"branch"`    // local name AddHostLink attaches
	HeadOwner     string         `json:"headOwner"` // '' unless Fork
	Fork          bool           `json:"fork"`
	Author        string         `json:"author"` // change request author login; '' for a branch link
	ChangeRequest *ChangeRequest `json:"changeRequest"`
	OnTaskID      string         `json:"onTaskId"` // live task already holding Branch
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
	HostURL   *string `json:"hostUrl"`
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
	// BaseHash is the WorkflowEntry.Hash the draft was built on; "" skips the check.
	BaseHash string `json:"baseHash"`
}

type SaveWorkflowYamlArgs struct {
	FileName string `json:"fileName"`
	Yaml     string `json:"yaml"`
	// BaseHash is the WorkflowYaml.Hash the text was edited from; "" skips the check.
	BaseHash string `json:"baseHash"`
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

type FolderHiddenArgs struct {
	Path   string `json:"path"`
	Hidden bool   `json:"hidden"`
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
	// FromStepID, when set, is the step the caller saw; the engine refuses with ErrStale when the
	// task has moved on. Desktop leaves it empty.
	FromStepID string `json:"fromStepId,omitempty"`
}

type StepArgs struct {
	TaskID string `json:"taskId"`
	StepID string `json:"stepId"`
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
	// ChangeRequest is the branch's change request number when the task's link names it; 0 = find
	// it by branch.
	ChangeRequest int `json:"changeRequest"`
}

// ReviewWorking is the uncommitted work of a branch's worktree against its HEAD (P384). Worktree
// is "" when the branch has none, with no Files. Head is "" for an unborn HEAD.
type ReviewWorking struct {
	Worktree string                 `json:"worktree"`
	Head     string                 `json:"head"`
	Files    []porcelain.FileChange `json:"files"`
}

// ReviewWorkingDiffArgs names one uncommitted file of a branch's worktree.
type ReviewWorkingDiffArgs struct {
	BranchID string `json:"branchId"`
	Path     string `json:"path"`
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

// ForwardReviewResult counts the open review comments pasted into the review agent.
type ForwardReviewResult struct {
	Count int `json:"count"`
}

// ReviewForwardText is the message ForwardReviewComments would send, composed for copying.
type ReviewForwardText struct {
	Text string `json:"text"`
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

type RestartSessionArgs struct {
	SessionID string `json:"sessionId"`
}

type LaunchStepArgs struct {
	TaskID  string `json:"taskId"`
	Message string `json:"message"`
	// FromStepID, when set, is the step the caller saw; the engine refuses with ErrStale when the
	// task has moved on. Desktop leaves it empty.
	FromStepID string `json:"fromStepId,omitempty"`
}

type StartBranchArgs struct {
	BranchID string `json:"branchId"`
	Message  string `json:"message"`
}

type SetTaskWorkflowArgs struct {
	TaskID     string `json:"taskId"`
	WorkflowID string `json:"workflowId"`
}

type SetTaskStepArgs struct {
	TaskID string `json:"taskId"`
	StepID string `json:"stepId"`
	// FromStepID, when set, is the step the caller saw; the engine refuses with ErrStale when the
	// task has moved on. Desktop leaves it empty.
	FromStepID string `json:"fromStepId,omitempty"`
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

// BasePick is one base the picker offers; Excluded is why it cannot be chosen: "" (choosable),
// "self" (the branch itself) or "stacked" (stacked on it).
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
