package scriptruns

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/runoutcome"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

const columns = `id, script_id, script_name, color, kind, trigger_kind, state, terminal_id, cwd, command, outcome_json, created_at, started_at, finished_at`

// keepFinished is how many finished runs are retained.
const keepFinished = 500

// Repo reads and writes script_runs.
type Repo struct{ DB *sql.DB }

type rowScanner interface{ Scan(dest ...any) error }

func scan(row rowScanner) (Run, error) {
	var r Run
	var outcome string
	var started, finished sql.NullInt64
	if err := row.Scan(&r.ID, &r.ScriptID, &r.ScriptName, &r.Color, &r.Kind, &r.Trigger, &r.State, &r.TerminalID,
		&r.Cwd, &r.Command, &outcome, &r.CreatedAt, &started, &finished); err != nil {
		return Run{}, err
	}
	if outcome != "" {
		var o runoutcome.Outcome
		if err := json.Unmarshal([]byte(outcome), &o); err != nil {
			return Run{}, fmt.Errorf("scriptruns: decode run %s outcome: %w", r.ID, err)
		}
		r.Outcome = &o
	}
	if started.Valid {
		r.StartedAt = &started.Int64
	}
	if finished.Valid {
		r.FinishedAt = &finished.Int64
	}
	return r, nil
}

func encode(o *runoutcome.Outcome) (string, error) {
	if o == nil {
		return "", nil
	}
	b, err := json.Marshal(o)
	if err != nil {
		return "", fmt.Errorf("scriptruns: encode outcome: %w", err)
	}
	return string(b), nil
}

// Insert writes a new run.
func (r *Repo) Insert(run Run) error {
	outcome, err := encode(run.Outcome)
	if err != nil {
		return err
	}
	if _, err := r.DB.Exec(`INSERT INTO script_runs (`+columns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.ScriptID, run.ScriptName, run.Color, run.Kind, run.Trigger, run.State, run.TerminalID,
		run.Cwd, run.Command, outcome, run.CreatedAt, run.StartedAt, run.FinishedAt); err != nil {
		return fmt.Errorf("scriptruns: insert %s: %w", run.ID, err)
	}
	return nil
}

// Get returns one run; sql.ErrNoRows wrapped when absent.
func (r *Repo) Get(id string) (Run, error) {
	run, err := scan(r.DB.QueryRow(`SELECT `+columns+` FROM script_runs WHERE id = ?`, id))
	if err != nil {
		return Run{}, fmt.Errorf("scriptruns: get %s: %w", id, err)
	}
	return run, nil
}

// List returns the newest runs first.
func (r *Repo) List(limit int) ([]Run, error) {
	rows, err := r.DB.Query(`SELECT `+columns+` FROM script_runs ORDER BY created_at DESC, id DESC LIMIT ?`, limit)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (Run, bool, error) {
		run, err := scan(rows)
		return run, true, err
	})
}

// Finish ends the running run matched by where (a column and value) with out; it returns the updated
// run, or (nil, nil) when no running row matches (a repeated exit).
func (r *Repo) finish(column, value string, out runoutcome.Outcome, now int64) (*Run, error) {
	outcome, err := encode(&out)
	if err != nil {
		return nil, err
	}
	var id string
	err = r.DB.QueryRow(`UPDATE script_runs SET state = ?, outcome_json = ?, finished_at = ?
		WHERE `+column+` = ? AND state = 'running' RETURNING id`, string(out.Status), outcome, now, value).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scriptruns: finish %s %s: %w", column, value, err)
	}
	run, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	return &run, nil
}

// FinishByRun ends a run by its id.
func (r *Repo) FinishByRun(id string, out runoutcome.Outcome, now int64) (*Run, error) {
	return r.finish("id", id, out, now)
}

// FinishByTerminal ends the running run bound to a terminal session.
func (r *Repo) FinishByTerminal(terminalID string, out runoutcome.Outcome, now int64) (*Run, error) {
	return r.finish("terminal_id", terminalID, out, now)
}

// FailRunning ends every running run with out and returns them.
func (r *Repo) FailRunning(out runoutcome.Outcome, now int64) ([]Run, error) {
	outcome, err := encode(&out)
	if err != nil {
		return nil, err
	}
	rows, err := r.DB.Query(`UPDATE script_runs SET state = ?, outcome_json = ?, finished_at = ?
		WHERE state = 'running' RETURNING `+columns, string(out.Status), outcome, now)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (Run, bool, error) {
		run, err := scan(rows)
		return run, true, err
	})
}

// Purge keeps only the newest keepFinished finished runs.
func (r *Repo) Purge() error {
	if _, err := r.DB.Exec(`DELETE FROM script_runs WHERE state <> 'running' AND id NOT IN
		(SELECT id FROM script_runs WHERE state <> 'running' ORDER BY created_at DESC, id DESC LIMIT ?)`, keepFinished); err != nil {
		return fmt.Errorf("scriptruns: purge: %w", err)
	}
	return nil
}
