package repos

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// AdeRunSandbox is one row of `ade_run_sandbox`: the policy a headless run started with. DenialsJSON
// is a JSON array of the first denials; DenialCount counts every one.
type AdeRunSandbox struct {
	RunID       string
	Access      string
	Enforced    bool
	Reason      string
	PolicyJSON  string
	Profile     string
	DenialCount int
	DenialsJSON string
}

// AdeRunSandboxRepo reads and writes `ade_run_sandbox`.
type AdeRunSandboxRepo struct {
	DB *sql.DB
}

// Insert stores a run's sandbox. The run row exists already.
func (r *AdeRunSandboxRepo) Insert(s AdeRunSandbox) error {
	enforced := 0
	if s.Enforced {
		enforced = 1
	}
	if _, err := r.DB.Exec(
		`INSERT INTO ade_run_sandbox (run_id, access, enforced, reason, policy_json, profile) VALUES (?, ?, ?, ?, ?, ?)`,
		s.RunID, s.Access, enforced, s.Reason, s.PolicyJSON, s.Profile,
	); err != nil {
		return fmt.Errorf("repos: insert run sandbox %s: %w", s.RunID, err)
	}
	return nil
}

// Get returns a run's sandbox, (nil, nil) when it ran without one.
func (r *AdeRunSandboxRepo) Get(runID string) (*AdeRunSandbox, error) {
	return sqlitex.QueryOne(r.DB, func(row *sql.Row) (*AdeRunSandbox, error) {
		var s AdeRunSandbox
		var enforced int
		err := row.Scan(&s.RunID, &s.Access, &enforced, &s.Reason, &s.PolicyJSON, &s.Profile, &s.DenialCount, &s.DenialsJSON)
		s.Enforced = enforced != 0
		return &s, err
	}, `SELECT run_id, access, enforced, reason, policy_json, profile, denial_count, denials_json FROM ade_run_sandbox WHERE run_id = ?`, runID)
}

// Badges returns the light columns (no profile or policy) of the given runs' rows, keyed by run id.
func (r *AdeRunSandboxRepo) Badges(runIDs []string) (map[string]AdeRunSandbox, error) {
	out := map[string]AdeRunSandbox{}
	if len(runIDs) == 0 {
		return out, nil
	}
	args := make([]any, len(runIDs))
	marks := make([]string, len(runIDs))
	for i, id := range runIDs {
		args[i], marks[i] = id, "?"
	}
	rows, err := r.DB.Query(`SELECT run_id, access, enforced, denial_count, denials_json FROM ade_run_sandbox WHERE run_id IN (`+strings.Join(marks, ",")+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("repos: run sandbox badges: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s AdeRunSandbox
		var enforced int
		if err := rows.Scan(&s.RunID, &s.Access, &enforced, &s.DenialCount, &s.DenialsJSON); err != nil {
			return nil, fmt.Errorf("repos: scan run sandbox badge: %w", err)
		}
		s.Enforced = enforced != 0
		out[s.RunID] = s
	}
	return out, rows.Err()
}

// AddDenials counts delta more denials; denialsJSON, when not empty, replaces the stored list.
func (r *AdeRunSandboxRepo) AddDenials(runID string, delta int, denialsJSON string) error {
	var err error
	if denialsJSON == "" {
		_, err = r.DB.Exec(`UPDATE ade_run_sandbox SET denial_count = denial_count + ? WHERE run_id = ?`, delta, runID)
	} else {
		_, err = r.DB.Exec(`UPDATE ade_run_sandbox SET denial_count = denial_count + ?, denials_json = ? WHERE run_id = ?`, delta, denialsJSON, runID)
	}
	if err != nil {
		return fmt.Errorf("repos: count sandbox denial %s: %w", runID, err)
	}
	return nil
}
