package repos

import (
	"database/sql"
	"fmt"

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

// AddDenial counts one more denial; denialsJSON, when not empty, replaces the stored list.
func (r *AdeRunSandboxRepo) AddDenial(runID, denialsJSON string) error {
	var err error
	if denialsJSON == "" {
		_, err = r.DB.Exec(`UPDATE ade_run_sandbox SET denial_count = denial_count + 1 WHERE run_id = ?`, runID)
	} else {
		_, err = r.DB.Exec(`UPDATE ade_run_sandbox SET denial_count = denial_count + 1, denials_json = ? WHERE run_id = ?`, denialsJSON, runID)
	}
	if err != nil {
		return fmt.Errorf("repos: count sandbox denial %s: %w", runID, err)
	}
	return nil
}
