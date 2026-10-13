package importer

import (
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/memory"
)

// Job states.
const (
	JobScanning  = "scanning"
	JobAwaiting  = "awaiting"
	JobRunning   = "running"
	JobPaused    = "paused"
	JobDone      = "done"
	JobCancelled = "cancelled"
	JobFailed    = "failed"
)

// File states.
const (
	FilePending    = "pending"
	FileSkipped    = "skipped"
	FileExtracting = "extracting"
	FileExtracted  = "extracted"
	FileVerifying  = "verifying"
	FileFinalizing = "finalizing"
	FileDone       = "done"
	FileFailed     = "failed"
	FileCancelled  = "cancelled"
)

// File kinds.
const (
	KindMarkdown = "markdown"
	KindText     = "text"
	KindJSON     = "json"
	KindJSONL    = "jsonl"
	// KindMemdoc is a file already in the kira-memory doc format: ingested by parse alone.
	KindMemdoc = "memdoc"
)

// Job channels: who started the job.
const (
	ChannelUI  = "ui"
	ChannelMCP = "mcp"
)

// ErrNotFound is returned when an id names no import job or file.
var ErrNotFound = errors.New("import not found")

func invalidState(what, state string) error {
	return fmt.Errorf("%w: %s is %s", memory.ErrInvalid, what, state)
}

// Estimate is the work a job will take, shown before it starts.
type Estimate struct {
	Files   int `json:"files"`
	Chunks  int `json:"chunks"`
	Tokens  int `json:"tokens"`
	Calls   int `json:"calls"`
	Seconds int `json:"seconds"`
}

type Progress struct {
	FilesDone   int `json:"filesDone"`
	FilesTotal  int `json:"filesTotal"`
	ChunksDone  int `json:"chunksDone"`
	ChunksTotal int `json:"chunksTotal"`
}

type Totals struct {
	Added        int `json:"added"`
	Updated      int `json:"updated"`
	Noop         int `json:"noop"`
	Dropped      int `json:"dropped"`
	Unresolved   int `json:"unresolved"`
	FailedFiles  int `json:"failedFiles"`
	SkippedFiles int `json:"skippedFiles"`
}

// Provenance is who decided the facts of a job and where they apply. SourceTag is set exactly for
// origin external; Project exactly for scope project; Session is the requesting Claude session.
type Provenance struct {
	Origin    string `json:"origin"`
	SourceTag string `json:"sourceTag"`
	Scope     string `json:"scope"`
	Project   string `json:"project"`
	Session   string `json:"session"`
}

// DefaultProvenance is what the UI import stored before provenance was chosen (P272's import mode).
var DefaultProvenance = Provenance{Origin: memory.OriginExternal, SourceTag: "doc", Scope: memory.ScopePersonal}

type Job struct {
	ID           string   `json:"id"`
	Roots        []string `json:"roots"`
	Base         string   `json:"base"`
	State        string   `json:"state"`
	Reason       string   `json:"reason"`
	Truncated    bool     `json:"truncated"`
	IgnoredCount int      `json:"ignoredCount"`
	Estimate     Estimate `json:"estimate"`
	Progress     Progress `json:"progress"`
	Totals       Totals   `json:"totals"`
	Channel      string   `json:"channel"`
	// Provenance fields are flat so the job JSON stays one level.
	Origin    string            `json:"origin"`
	SourceTag *string           `json:"sourceTag"`
	Scope     string            `json:"scope"`
	Project   *string           `json:"project"`
	SessionID *string           `json:"sessionId"`
	Groups    []memory.GroupRef `json:"groups"`
	AutoStart bool              `json:"autoStart"`
	WriteDoc  bool              `json:"writeDoc"`
	// Calls and CostUSD cover the extract and finalize agents only, not the memory gate's own checks.
	Calls      int     `json:"calls"`
	CostUSD    float64 `json:"costUsd"`
	CreatedAt  string  `json:"createdAt"`
	StartedAt  *string `json:"startedAt"`
	FinishedAt *string `json:"finishedAt"`
}

type File struct {
	ID         string           `json:"id"`
	RelPath    string           `json:"relPath"`
	Kind       string           `json:"kind"`
	Size       int64            `json:"size"`
	State      string           `json:"state"`
	Reason     string           `json:"reason"`
	Title      string           `json:"title"`
	ChunkCount int              `json:"chunkCount"`
	ChunksDone int              `json:"chunksDone"`
	FactCount  int              `json:"factCount"`
	Added      int              `json:"added"`
	Updated    int              `json:"updated"`
	Noop       int              `json:"noop"`
	Unresolved []UnresolvedFact `json:"unresolved"`
	Dropped    []DroppedFact    `json:"dropped"`
	CostUSD    float64          `json:"costUsd"`
	// Verified counts facts the cross-check step judged; Orphaned counts stored facts a re-ingested
	// memdoc no longer lists.
	Verified int `json:"verified"`
	Orphaned int `json:"orphaned"`
	// GroupID is the file's document group ("kg_..."): the doc header's for memdoc, else the path's.
	GroupID string `json:"groupId"`
	// Prov is a memdoc file's own header provenance; nil for other kinds.
	Prov     *Provenance `json:"prov"`
	DocPath  string      `json:"docPath"`
	DocError string      `json:"docError"`
	// FactIDs are up to 50 stored fact ids of this file (status tool only).
	FactIDs []string `json:"factIds,omitempty"`
}

type JobDetail struct {
	Job   Job    `json:"job"`
	Files []File `json:"files"`
}
