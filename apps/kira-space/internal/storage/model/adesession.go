package model

import "fmt"

// AdeSessionStateRunning/AdeSessionStateStopped mirror ade_sessions.state's own CHECK constraint
// (migrations/0004_p129_ade_sessions.sql) — the two states ade.Tracker ever writes.
const (
	AdeSessionStateRunning = "running"
	AdeSessionStateStopped = "stopped"
)

// AdeSessionMode* mirror ade_sessions.mode's CHECK (migrations/0010_p146_ade_runs.sql).
const (
	AdeSessionModeTUI      = "tui"
	AdeSessionModeHeadless = "headless"
)

// AdeSession is one row of `ade_sessions` (P129 Part 1 §4.7) — a Claude Code session this app's own
// ade.Tracker spawned or resumed, keyed on ID (never ClaudeSessionID, which can change across a
// session's own /clear). Exactly one of Branch/NewWorkID is ever set, matching the table's own
// CHECK: a session launched against a plain branch checkout carries no new-work id and vice versa.
// TerminalID is "" once the session has stopped — a history row outlives its own live terminal.
type AdeSession struct {
	ID              string `json:"id"`
	CodeRepoID      string `json:"codeRepoId"`
	Branch          string `json:"branch"`
	NewWorkID       string `json:"newWorkId"`
	ClaudeSessionID string `json:"claudeSessionId"`
	Cwd             string `json:"cwd"`
	State           string `json:"state"`
	TerminalID      string `json:"terminalId"`
	StartedAt       int64  `json:"startedAt"`
	LastActiveAt    int64  `json:"lastActiveAt"`
	// P146 v2 columns. TaskID == "" marks a v1 row (Mode "tui", CodeRepoID/Branch|NewWorkID set); a
	// v2 row carries a task, no code repo and no v1 branch fields.
	Mode     string `json:"mode"`
	TaskID   string `json:"taskId"`
	BranchID string `json:"branchId"`
	StageID  string `json:"stageId"`
	StepID   string `json:"stepId"`
	RunID    string `json:"runId"`
	Resumes  string `json:"resumes"`
}

// Validate asserts the identity/shape fields no SQL constraint covers by itself (the CHECK on
// state and on branch/new_work_id mutual exclusion still guard the DB directly; this catches the
// same mistakes earlier, with a message naming the record).
func (s AdeSession) Validate() error {
	if s.ID == "" {
		return fmt.Errorf("model: ade session: id is required")
	}
	if s.TaskID == "" {
		if s.CodeRepoID == "" {
			return fmt.Errorf("model: ade session %q: codeRepoId is required", s.ID)
		}
		if (s.Branch == "") == (s.NewWorkID == "") {
			return fmt.Errorf("model: ade session %q: exactly one of branch/newWorkId is required", s.ID)
		}
		if s.Mode != "" && s.Mode != AdeSessionModeTUI {
			return fmt.Errorf("model: ade session %q: a v1 row is a tui session", s.ID)
		}
	} else {
		if s.Branch != "" || s.NewWorkID != "" {
			return fmt.Errorf("model: ade session %q: a task session carries no branch/newWorkId", s.ID)
		}
		if s.Mode != AdeSessionModeTUI && s.Mode != AdeSessionModeHeadless {
			return fmt.Errorf("model: ade session %q: invalid mode %q", s.ID, s.Mode)
		}
		if s.Mode == AdeSessionModeHeadless && s.RunID == "" {
			return fmt.Errorf("model: ade session %q: a headless session needs a runId", s.ID)
		}
	}
	if s.ClaudeSessionID == "" {
		return fmt.Errorf("model: ade session %q: claudeSessionId is required", s.ID)
	}
	if s.Cwd == "" {
		return fmt.Errorf("model: ade session %q: cwd is required", s.ID)
	}
	if s.State != AdeSessionStateRunning && s.State != AdeSessionStateStopped {
		return fmt.Errorf("model: ade session %q: invalid state %q", s.ID, s.State)
	}
	return nil
}
