package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

const adeSessionsSelectColumns = `id, code_repo_id, branch, new_work_id, claude_session_id, cwd, state, terminal_id, started_at, last_active_at,
	mode, task_id, branch_id, stage_id, step_id, run_id, resumes`

// AdeSessionsRepo reads and writes `ade_sessions` (P129 Part 1 §4.7) — ade.Tracker's own history
// of every Claude Code session it has spawned or resumed.
type AdeSessionsRepo struct {
	DB *sql.DB
}

func scanAdeSessionRow(row rowScanner) (model.AdeSession, error) {
	var rec model.AdeSession
	var terminalID, codeRepoID sql.NullString
	if err := row.Scan(
		&rec.ID, &codeRepoID, &rec.Branch, &rec.NewWorkID, &rec.ClaudeSessionID, &rec.Cwd,
		&rec.State, &terminalID, &rec.StartedAt, &rec.LastActiveAt,
		&rec.Mode, &rec.TaskID, &rec.BranchID, &rec.StageID, &rec.StepID, &rec.RunID, &rec.Resumes,
	); err != nil {
		return model.AdeSession{}, err
	}
	rec.CodeRepoID = codeRepoID.String
	rec.TerminalID = terminalID.String
	return rec, nil
}

// Get reads one row by id, (nil, nil) when not found — the same "no error on a miss" discipline
// CodeReposRepo.Get already follows.
func (r *AdeSessionsRepo) Get(id string) (*model.AdeSession, error) {
	rec, err := sqlitex.QueryOne(r.DB, func(row *sql.Row) (*model.AdeSession, error) {
		s, err := scanAdeSessionRow(row)
		if err != nil {
			return nil, err
		}
		return &s, nil
	}, `SELECT `+adeSessionsSelectColumns+` FROM ade_sessions WHERE id = ?`, id)
	if err != nil {
		return nil, fmt.Errorf("repos: get ade session %s: %w", id, err)
	}
	return rec, nil
}

// List returns every v1 row (task_id = ”), most recently active first — Tracker.Recover's own boot
// read and AdeService.Sessions' own wire projection both use this, never a paged or filtered
// variant (this app's own session count never approaches a size where that would matter). v2 task
// rows are ListTask's.
func (r *AdeSessionsRepo) List() ([]model.AdeSession, error) {
	rows, err := r.DB.Query(`SELECT ` + adeSessionsSelectColumns + ` FROM ade_sessions WHERE task_id = '' ORDER BY last_active_at DESC`)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeSession, bool, error) {
		rec, err := scanAdeSessionRow(rows)
		return rec, true, err
	})
}

// ListByRepo is List narrowed to one code repo, on the ade_sessions_repo index.
func (r *AdeSessionsRepo) ListByRepo(codeRepoID string) ([]model.AdeSession, error) {
	rows, err := r.DB.Query(`SELECT `+adeSessionsSelectColumns+` FROM ade_sessions WHERE code_repo_id = ? AND task_id = '' ORDER BY last_active_at DESC`, codeRepoID)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeSession, bool, error) {
		rec, err := scanAdeSessionRow(rows)
		return rec, true, err
	})
}

// Insert writes a newly spawned session's own row — always state='running', terminal_id set,
// called right after Tracker.Compose hands back a composed command (§4.2's own ordering: the row
// exists before the process the terminal_id names does).
func (r *AdeSessionsRepo) Insert(rec model.AdeSession) error {
	if err := rec.Validate(); err != nil {
		return fmt.Errorf("repos: %w", err)
	}
	if _, err := r.DB.Exec(
		`INSERT INTO ade_sessions (id, code_repo_id, branch, new_work_id, claude_session_id, cwd, state, terminal_id, started_at, last_active_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.ID, rec.CodeRepoID, rec.Branch, rec.NewWorkID, rec.ClaudeSessionID, rec.Cwd, rec.State,
		nullableString(rec.TerminalID), rec.StartedAt, rec.LastActiveAt,
	); err != nil {
		return fmt.Errorf("repos: insert ade session %s: %w", rec.ID, err)
	}
	return nil
}

// ListTask returns every v2 row (task_id <> ”), running first then most recently active.
func (r *AdeSessionsRepo) ListTask() ([]model.AdeSession, error) {
	rows, err := r.DB.Query(`SELECT ` + adeSessionsSelectColumns + ` FROM ade_sessions WHERE task_id <> ''
		ORDER BY state = 'running' DESC, last_active_at DESC, id`)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeSession, bool, error) {
		rec, err := scanAdeSessionRow(rows)
		return rec, true, err
	})
}

// InsertHeadless writes a v2 task session row (no code repo, no terminal).
func (r *AdeSessionsRepo) InsertHeadless(rec model.AdeSession) error {
	if rec.TaskID == "" {
		return fmt.Errorf("repos: insert headless ade session %s: taskId is required", rec.ID)
	}
	if err := rec.Validate(); err != nil {
		return fmt.Errorf("repos: %w", err)
	}
	if _, err := r.DB.Exec(
		`INSERT INTO ade_sessions (id, code_repo_id, mode, task_id, branch_id, stage_id, step_id, run_id, resumes,
			claude_session_id, cwd, state, terminal_id, started_at, last_active_at)
		 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.ID, rec.Mode, rec.TaskID, rec.BranchID, rec.StageID, rec.StepID, rec.RunID, rec.Resumes,
		rec.ClaudeSessionID, rec.Cwd, rec.State, nullableString(rec.TerminalID), rec.StartedAt, rec.LastActiveAt,
	); err != nil {
		return fmt.Errorf("repos: insert headless ade session %s: %w", rec.ID, err)
	}
	return nil
}

// MarkRunning sets state='running' and terminal_id — Tracker.Compose's own resume path (a
// previously stopped session picked back up under a fresh terminal id).
func (r *AdeSessionsRepo) MarkRunning(id, terminalID string, lastActiveAt int64) error {
	res, err := r.DB.Exec(
		`UPDATE ade_sessions SET state = ?, terminal_id = ?, last_active_at = ? WHERE id = ?`,
		model.AdeSessionStateRunning, nullableString(terminalID), lastActiveAt, id,
	)
	if err != nil {
		return fmt.Errorf("repos: mark ade session running %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "ade session "+id)
}

// MarkStopped sets state='stopped' and clears terminal_id — Tracker.Reconcile's own exit path
// (the pty is gone; the row's own history stays, just with nothing live to point at).
func (r *AdeSessionsRepo) MarkStopped(id string, lastActiveAt int64) error {
	res, err := r.DB.Exec(
		`UPDATE ade_sessions SET state = ?, terminal_id = NULL, last_active_at = ? WHERE id = ?`,
		model.AdeSessionStateStopped, lastActiveAt, id,
	)
	if err != nil {
		return fmt.Errorf("repos: mark ade session stopped %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "ade session "+id)
}

// SetClaudeSessionID updates the tracked Claude session id — a session's own id can change across
// a /clear (a fresh SessionStart with a different session_id, same terminal_id); this keeps the
// row pointed at whichever id `--resume` must pass next.
func (r *AdeSessionsRepo) SetClaudeSessionID(id, claudeSessionID string) error {
	res, err := r.DB.Exec(`UPDATE ade_sessions SET claude_session_id = ? WHERE id = ?`, claudeSessionID, id)
	if err != nil {
		return fmt.Errorf("repos: set ade session claude session id %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "ade session "+id)
}

// SetLastActive bumps last_active_at alone — every hook event Tracker.HandleEvent sees for a
// running session touches this, without needing a full row re-read first.
func (r *AdeSessionsRepo) SetLastActive(id string, lastActiveAt int64) error {
	res, err := r.DB.Exec(`UPDATE ade_sessions SET last_active_at = ? WHERE id = ?`, lastActiveAt, id)
	if err != nil {
		return fmt.Errorf("repos: set ade session last active %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "ade session "+id)
}

// StopAllRunning marks every still-'running' row 'stopped' and clears its terminal_id — Recover's
// own boot-time call, since no terminal from a previous process life is ever still alive under a
// fresh Registry (P129 Part 1 §4.4). Affecting zero rows is not an error: a fresh database, or one
// where every prior session had already stopped cleanly, is the ordinary case.
func (r *AdeSessionsRepo) StopAllRunning(now int64) error {
	if _, err := r.DB.Exec(
		`UPDATE ade_sessions SET state = ?, terminal_id = NULL, last_active_at = ? WHERE state = ? AND task_id = ''`,
		model.AdeSessionStateStopped, now, model.AdeSessionStateRunning,
	); err != nil {
		return fmt.Errorf("repos: stop all running ade sessions: %w", err)
	}
	return nil
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
