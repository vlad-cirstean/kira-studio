package repos

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// GitClientRow is the full row shape, including the salted hash — used only inside this package
// and by internal/gitsock's token verification (via the structural TrustStore interface it
// declares itself, so gitsock never imports storage/repos types beyond this one). Never crosses
// to the renderer; model.GitClient is that projection.
type GitClientRow struct {
	ID         string
	Label      string
	TokenHash  []byte
	TokenSalt  []byte
	CreatedAt  int64
	LastSeenAt int64
	RevokedAt  *int64
}

// GitClientsRepo is G1's trust store for paired VS Code extensions (SPEC §3.3, D7).
type GitClientsRepo struct {
	DB *sql.DB
}

const gitClientColumns = `id, label, token_hash, token_salt, created_at, last_seen_at, revoked_at`

// ByID reads one row by client id, for handshake verification. The second return is false (with a
// nil error) when no such row exists — the miss itself is not an error condition; the handshake's
// D6 timing discipline is the caller's job, not this repo's.
func (r *GitClientsRepo) ByID(id string) (GitClientRow, bool, error) {
	row := r.DB.QueryRow(`SELECT `+gitClientColumns+` FROM git_clients WHERE id = ?`, id)
	rec, err := scanGitClientRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return GitClientRow{}, false, nil
	}
	if err != nil {
		return GitClientRow{}, false, fmt.Errorf("repos/gitclients: by id %s: %w", id, err)
	}
	return rec, true, nil
}

// Insert adds a newly paired client. Called after the pairing broker's approval and before the
// wire's "paired" frame is sent (D8's own ordering rule) — a token whose row does not yet exist
// would leave the extension unable to ever reconnect.
func (r *GitClientsRepo) Insert(row GitClientRow) error {
	_, err := r.DB.Exec(
		`INSERT INTO git_clients (`+gitClientColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		row.ID, row.Label, row.TokenHash, row.TokenSalt, row.CreatedAt, row.LastSeenAt, row.RevokedAt,
	)
	if err != nil {
		return fmt.Errorf("repos/gitclients: insert %s: %w", row.ID, err)
	}
	return nil
}

// TouchLastSeen updates last_seen_at on a successful handshake (handshake table row 4).
func (r *GitClientsRepo) TouchLastSeen(id string, now int64) error {
	res, err := r.DB.Exec(`UPDATE git_clients SET last_seen_at = ? WHERE id = ?`, now, id)
	if err != nil {
		return fmt.Errorf("repos/gitclients: touch last seen %s: %w", id, err)
	}
	return requireOneRow(res, "git client", id)
}

// Revoke sets revoked_at. gitsock.Server.Revoke calls this before closing any live connection
// (D18's ordering) so a race between the write and a concurrent reconnect can never re-admit the
// revoked client.
func (r *GitClientsRepo) Revoke(id string, now int64) error {
	res, err := r.DB.Exec(`UPDATE git_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, id)
	if err != nil {
		return fmt.Errorf("repos/gitclients: revoke %s: %w", id, err)
	}
	return requireOneRow(res, "git client", id)
}

// List returns every client — revoked ones included, so the Connected editors pane can still show
// history — most recently seen first, projected to model.GitClient (never the hash or the salt).
func (r *GitClientsRepo) List() ([]model.GitClient, error) {
	rows, err := r.DB.Query(`SELECT id, label, created_at, last_seen_at, revoked_at FROM git_clients ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("repos/gitclients: list: %w", err)
	}
	defer rows.Close()

	out := []model.GitClient{}
	for rows.Next() {
		var c model.GitClient
		if err := rows.Scan(&c.ID, &c.Label, &c.CreatedAt, &c.LastSeenAt, &c.RevokedAt); err != nil {
			return nil, fmt.Errorf("repos/gitclients: scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/gitclients: rows: %w", err)
	}
	return out, nil
}

func scanGitClientRow(row *sql.Row) (GitClientRow, error) {
	var rec GitClientRow
	if err := row.Scan(&rec.ID, &rec.Label, &rec.TokenHash, &rec.TokenSalt, &rec.CreatedAt, &rec.LastSeenAt, &rec.RevokedAt); err != nil {
		return GitClientRow{}, err
	}
	return rec, nil
}
