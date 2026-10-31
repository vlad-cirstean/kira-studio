package oplog

// Operation categories. Open set: later phases add more.
const (
	CategoryGit     = "git"
	CategorySession = "session"
	CategoryMCP     = "mcp"
)

// Modules that originate an operation.
const (
	ModuleGit    = "git"
	ModuleADE    = "ade"
	ModuleFiles  = "files"
	ModuleVSCode = "vscode"
	ModuleApp    = "app"
)

// Triggers: who asked for the operation.
const (
	TriggerUser = "user"
	TriggerMCP  = "mcp"
	TriggerAuto = "auto"
)

const (
	StatusRunning   = "running"
	StatusOK        = "ok"
	StatusError     = "error"
	StatusCancelled = "cancelled"
)

// Step is one git spawn an operation ran. Argv is already redacted.
type Step struct {
	Argv       string  `json:"argv"`
	ReadOnly   bool    `json:"readOnly"`
	ExitCode   *int    `json:"exitCode"`
	DurationMs *int    `json:"durationMs"`
	Status     string  `json:"status"`
	Stderr     *string `json:"stderr"`
}

// Record is the wire shape; it matches packages/shared/domain/ops.ts plus Space fields.
type Record struct {
	ID           string  `json:"id"`
	StartedAt    string  `json:"startedAt"`
	DurationMs   *int    `json:"durationMs"`
	Category     string  `json:"category"`
	Kind         string  `json:"kind"`
	Status       string  `json:"status"`
	Module       string  `json:"module"`
	Trigger      string  `json:"trigger"`
	Source       string  `json:"source"`
	Subject      string  `json:"subject"`
	Command      *string `json:"command"`
	Error        *string `json:"error"`
	RepoRoot     string  `json:"repoRoot"`
	RepoName     string  `json:"repoName"`
	TaskID       string  `json:"taskId"`
	ParentID     string  `json:"parentId"`
	Background   bool    `json:"background"`
	Repeat       int     `json:"repeat"`
	Steps        []Step  `json:"steps"`
	StepsDropped int     `json:"stepsDropped"`
	Cancellable  bool    `json:"cancellable"`
}

// Meta identifies the operation being started. Module, trigger, task and parent come from the ctx.
type Meta struct {
	Category, Kind, RepoRoot, RepoName, Source, Subject string
	// Background marks a high-volume read the panel hides by default.
	Background bool
}

func (r *Record) clone() Record {
	c := *r
	c.Steps = append(make([]Step, 0, len(r.Steps)), r.Steps...)
	return c
}
