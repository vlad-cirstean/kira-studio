package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

const codeReposSelectColumns = `id, name, root, repo_id, sort_order, created_at`

// CodeReposRepo reads and writes the `code_repos` table (C5 §3.1) — the repo-import store.
type CodeReposRepo struct {
	DB *sql.DB
}

func scanCodeRepoRow(row rowScanner) (model.CodeRepo, error) {
	var r model.CodeRepo
	if err := row.Scan(&r.ID, &r.Name, &r.Root, &r.RepoID, &r.SortOrder, &r.CreatedAt); err != nil {
		return model.CodeRepo{}, err
	}
	return r, nil
}

// List orders by sort_order ASC, name ASC.
func (r *CodeReposRepo) List() ([]model.CodeRepo, error) {
	rows, err := r.DB.Query(`SELECT ` + codeReposSelectColumns + ` FROM code_repos ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, fmt.Errorf("repos: query code repos: %w", err)
	}
	defer rows.Close()

	out := []model.CodeRepo{}
	for rows.Next() {
		rec, err := scanCodeRepoRow(rows)
		if err != nil {
			return nil, fmt.Errorf("repos: scan code repo: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: code repo rows: %w", err)
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
		return nil, fmt.Errorf("repos: get code repo %s: %w", id, err)
	}
	return &rec, nil
}

// Create inserts a new row, sort_order set to one past the current max — repo_id's UNIQUE index is
// what actually refuses importing the same checkout twice; the caller
// (CodeWorkspaceService.ImportRepo) checks first only to return a friendlier error than a raw
// constraint violation.
func (r *CodeReposRepo) Create(rec model.CodeRepo) (model.CodeRepo, error) {
	if err := rec.Validate(); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos: %w", err)
	}
	var maxOrder sql.NullInt64
	if err := r.DB.QueryRow(`SELECT MAX(sort_order) FROM code_repos`).Scan(&maxOrder); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos: code repo max sort_order: %w", err)
	}
	rec.SortOrder = int(maxOrder.Int64) + 1
	if _, err := r.DB.Exec(
		`INSERT INTO code_repos (id, name, root, repo_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		rec.ID, rec.Name, rec.Root, rec.RepoID, rec.SortOrder, rec.CreatedAt,
	); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos: insert code repo: %w", err)
	}
	return rec, nil
}

// Rename updates only the label — root/repoId are the checkout's own identity, never user-edited.
func (r *CodeReposRepo) Rename(id, name string) (model.CodeRepo, error) {
	if name == "" {
		return model.CodeRepo{}, fmt.Errorf("repos: rename code repo %s: name is required", id)
	}
	if _, err := r.DB.Exec(`UPDATE code_repos SET name = ? WHERE id = ?`, name, id); err != nil {
		return model.CodeRepo{}, fmt.Errorf("repos: rename code repo %s: %w", id, err)
	}
	rec, err := r.Get(id)
	if err != nil {
		return model.CodeRepo{}, err
	}
	if rec == nil {
		return model.CodeRepo{}, fmt.Errorf("repos: rename code repo %s: not found", id)
	}
	return *rec, nil
}

// Remove deletes the repo row. Kira Studio's own Remove also deletes every `tabs` row scoped to
// the repo's workspace in the same transaction — Kira Space has no `tabs` table yet (this
// package's own migrations/0001_init.sql header comment: deferred to Part 2, which is also where
// this method picks that cascade back up once the table exists to cascade into).
func (r *CodeReposRepo) Remove(id string) error {
	if _, err := r.DB.Exec(`DELETE FROM code_repos WHERE id = ?`, id); err != nil {
		return fmt.Errorf("repos: remove code repo %s: %w", id, err)
	}
	return nil
}
