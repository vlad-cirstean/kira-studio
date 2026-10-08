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
	FileFinalizing = "finalizing"
	FileDone       = "done"
	FileFailed     = "failed"
	FileCancelled  = "cancelled"
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
	Unresolved   int `json:"unresolved"`
	FailedFiles  int `json:"failedFiles"`
	SkippedFiles int `json:"skippedFiles"`
}

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
}

type JobDetail struct {
	Job   Job    `json:"job"`
	Files []File `json:"files"`
}
