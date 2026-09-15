package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const codeReposSelectColumns = `id, name, root, repo_id, sort_order, created_at, mcp_enabled`

// CodeReposRepo reads and writes the `code_repos` table (C5 §3.1) — the repo-import store beside
// ConnectionsRepo, never an extension of it (D1).
type CodeReposRepo struct {
	DB *sql.DB
}

func scanCodeRepoRow(row rowScanner) (model.CodeRepo, error) {
	var r model.CodeRepo
	if err := row.Scan(&r.ID, &r.Name, &r.Root, &r.RepoID, &r.SortOrder, &r.CreatedAt, &r.McpEnabled); err != nil {
		return model.CodeRepo{}, err
	}
	return r, nil
}

// List orders by sort_order ASC, name ASC — the same tiebreak ConnectionsRepo.List uses for two
// rows sharing a sort_order.
func (r *CodeReposRepo) List() ([]model.CodeRepo, error) {
	rows, err := r.DB.Query(`SELECT ` + codeReposSelectColumns + ` FROM code_repos ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, fmt.Errorf("repos/coderepos: query: %w", err)
	}
	defer rows.Close()

	out := []model.CodeRepo{}
	for rows.Next() {
		rec, err := scanCodeRepoRow(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/coderepos: scan: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/coderepos: rows: %w", err)
	}
	return out, nil
}

// Get reads one row by id, (nil, nil) when not found — CodeWorkspaceService's own callers
// distinguish "not found" from a real error rather than getting sql.ErrNoRows leaking upward.
func (r *CodeReposRepo) Get(id string) (*model.CodeRepo, error) {
	row := r.DB.QueryRow(`SELECT `+codeReposSelectColumns+` FROM code_repos WHERE id = ?`, id)
	rec, err := scanCodeRepoRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("repos/coderepos: get %s: %w", id, err)
	}
	return &rec, nil
}

// Create inserts a new row, sort_order set to one past the current max (matching
// ConnectionsRepo's own append-at-the-end convention) — repo_id's UNIQUE index is what actually
// refuses importing the same checkout twice; the caller (CodeWorkspaceService.ImportRepo) checks
// first only to return a friendlier error than a raw constraint violation.
func (r *CodeReposRepo) Create(rec model.CodeRepo) (model.CodeRepo, error) {
	if err := rec.Validate(); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos/coderepos: %w", err)
	}
	var maxOrder sql.NullInt64
	if err := r.DB.QueryRow(`SELECT MAX(sort_order) FROM code_repos`).Scan(&maxOrder); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos/coderepos: max sort_order: %w", err)
	}
	rec.SortOrder = int(maxOrder.Int64) + 1
	// mcp_enabled is inserted explicitly as 0 — a fresh import is never granted MCP access by
	// import alone (P67d §5's own "fail-closed, always explicit").
	if _, err := r.DB.Exec(
		`INSERT INTO code_repos (id, name, root, repo_id, sort_order, created_at, mcp_enabled) VALUES (?, ?, ?, ?, ?, ?, 0)`,
		rec.ID, rec.Name, rec.Root, rec.RepoID, rec.SortOrder, rec.CreatedAt,
	); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos/coderepos: insert: %w", err)
	}
	rec.McpEnabled = false
	return rec, nil
}

// SetMcpEnabled persists P67d's own per-repository MCP grant/revoke — bridge.RepoMapService's
// SetRepoEnabled, the storage half. Returns sql.ErrNoRows (wrapped) when id matches no row, the same
// sentinel this package's own read paths already use for "not found" (gitclients.go's ByID) —
// unlike every sibling write method here, this used to never check RowsAffected at all, silently
// "succeeding" for a nonexistent id.
func (r *CodeReposRepo) SetMcpEnabled(id string, enabled bool) error {
	res, err := r.DB.Exec(`UPDATE code_repos SET mcp_enabled = ? WHERE id = ?`, enabled, id)
	if err != nil {
		return fmt.Errorf("repos/coderepos: set mcp_enabled %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos/coderepos: set mcp_enabled %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return fmt.Errorf("repos/coderepos: set mcp_enabled %s: %w", id, sql.ErrNoRows)
	}
	return nil
}

// Rename updates only the label — root/repoId are the checkout's own identity, never user-edited.
func (r *CodeReposRepo) Rename(id, name string) (model.CodeRepo, error) {
	if name == "" {
		return model.CodeRepo{}, fmt.Errorf("repos/coderepos: rename %s: name is required", id)
	}
	if _, err := r.DB.Exec(`UPDATE code_repos SET name = ? WHERE id = ?`, name, id); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos/coderepos: rename %s: %w", id, err)
	}
	rec, err := r.Get(id)
	if err != nil {
		return model.CodeRepo{}, err
	}
	if rec == nil {
		return model.CodeRepo{}, fmt.Errorf("repos/coderepos: rename %s: not found", id)
	}
	return *rec, nil
}

// Remove deletes the repo row and every tab row scoped to its workspace, in one transaction (§3.1:
// "so the store stays consistent even if the renderer never gets to close them") — no foreign key
// from `tabs` (workspace_id is a key, not a row reference), so this is the one place that keeps
// them from outliving the repo they belong to.
func (r *CodeReposRepo) Remove(id string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/coderepos: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	workspaceID := "repo:" + id
	if _, err := tx.Exec(`DELETE FROM tabs WHERE workspace_id = ?`, workspaceID); err != nil {
		return fmt.Errorf("repos/coderepos: remove %s: delete tabs: %w", id, err)
	}
	if _, err := tx.Exec(`DELETE FROM code_repos WHERE id = ?`, id); err != nil {
		return fmt.Errorf("repos/coderepos: remove %s: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/coderepos: commit: %w", err)
	}
	return nil
}
