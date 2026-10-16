package repos

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

const adeBacklogColumns = `id, text, position, jira_key, jira_url, github_url, notes, added_at`

// AdeBacklogRepo reads and writes ade_backlog: the ordered list of work not yet a task.
type AdeBacklogRepo struct {
	DB *sql.DB
}

func scanAdeBacklog(row rowScanner) (model.AdeBacklogItem, error) {
	var i model.AdeBacklogItem
	err := row.Scan(&i.ID, &i.Text, &i.Position, &i.JiraKey, &i.JiraURL, &i.GithubURL, &i.Notes, &i.AddedAt)
	return i, err
}

// List returns the items top first.
func (r *AdeBacklogRepo) List() ([]model.AdeBacklogItem, error) {
	rows, err := r.DB.Query(`SELECT ` + adeBacklogColumns + ` FROM ade_backlog ORDER BY position, id`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade backlog: %w", err)
	}
	defer rows.Close()
	out := make([]model.AdeBacklogItem, 0)
	for rows.Next() {
		i, err := scanAdeBacklog(rows)
		if err != nil {
			return nil, fmt.Errorf("repos: scan ade backlog: %w", err)
		}
		out = append(out, i)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade backlog rows: %w", err)
	}
	return out, nil
}

// Add inserts i at the top (position = min-1) and returns the stored item.
func (r *AdeBacklogRepo) Add(i model.AdeBacklogItem) (model.AdeBacklogItem, error) {
	if err := i.Validate(); err != nil {
		return model.AdeBacklogItem{}, err
	}
	if err := r.DB.QueryRow(`SELECT COALESCE(MIN(position) - 1, 0) FROM ade_backlog`).Scan(&i.Position); err != nil {
		return model.AdeBacklogItem{}, fmt.Errorf("repos: next ade backlog position: %w", err)
	}
	if _, err := r.DB.Exec(`INSERT INTO ade_backlog (`+adeBacklogColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		i.ID, i.Text, i.Position, i.JiraKey, i.JiraURL, i.GithubURL, i.Notes, i.AddedAt); err != nil {
		return model.AdeBacklogItem{}, fmt.Errorf("repos: insert ade backlog %s: %w", i.ID, err)
	}
	return i, nil
}

// Update writes the patched leaves and returns the stored item.
func (r *AdeBacklogRepo) Update(id string, p model.AdeBacklogPatch) (model.AdeBacklogItem, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.AdeBacklogItem{}, fmt.Errorf("repos: begin update ade backlog: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	cur, err := scanAdeBacklog(tx.QueryRow(`SELECT `+adeBacklogColumns+` FROM ade_backlog WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdeBacklogItem{}, ErrBacklogGone
	}
	if err != nil {
		return model.AdeBacklogItem{}, fmt.Errorf("repos: select ade backlog %s: %w", id, err)
	}
	if p.Text != nil {
		cur.Text = *p.Text
	}
	if p.JiraKey != nil {
		cur.JiraKey = *p.JiraKey
	}
	if p.JiraURL != nil {
		cur.JiraURL = *p.JiraURL
	}
	if p.GithubURL != nil {
		cur.GithubURL = *p.GithubURL
	}
	if p.Notes != nil {
		cur.Notes = *p.Notes
	}
	if err := cur.Validate(); err != nil {
		return model.AdeBacklogItem{}, err
	}
	if _, err := tx.Exec(`UPDATE ade_backlog SET text = ?, jira_key = ?, jira_url = ?, github_url = ?, notes = ? WHERE id = ?`,
		cur.Text, cur.JiraKey, cur.JiraURL, cur.GithubURL, cur.Notes, id); err != nil {
		return model.AdeBacklogItem{}, fmt.Errorf("repos: update ade backlog %s: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return model.AdeBacklogItem{}, fmt.Errorf("repos: commit update ade backlog %s: %w", id, err)
	}
	return cur, nil
}

// Move places id at toIndex (clamped) and rewrites positions densely, in one transaction.
func (r *AdeBacklogRepo) Move(id string, toIndex int) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin move ade backlog: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	rows, err := tx.Query(`SELECT id FROM ade_backlog ORDER BY position, id`)
	if err != nil {
		return fmt.Errorf("repos: query ade backlog: %w", err)
	}
	ids := make([]string, 0)
	found := false
	for rows.Next() {
		var cur string
		if err := rows.Scan(&cur); err != nil {
			rows.Close()
			return fmt.Errorf("repos: scan ade backlog: %w", err)
		}
		if cur == id {
			found = true
			continue
		}
		ids = append(ids, cur)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("repos: ade backlog rows: %w", err)
	}
	rows.Close()
	if !found {
		return ErrBacklogGone
	}
	toIndex = max(0, min(toIndex, len(ids)))
	ids = append(ids[:toIndex], append([]string{id}, ids[toIndex:]...)...)
	for i, cur := range ids {
		if _, err := tx.Exec(`UPDATE ade_backlog SET position = ? WHERE id = ?`, i, cur); err != nil {
			return fmt.Errorf("repos: move ade backlog %s: %w", cur, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit move ade backlog: %w", err)
	}
	return nil
}

// Delete removes one item.
func (r *AdeBacklogRepo) Delete(id string) error {
	res, err := r.DB.Exec(`DELETE FROM ade_backlog WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("repos: delete ade backlog %s: %w", id, err)
	}
	if err := sqlitex.RequireOneRow(res, "ade backlog item "+id); err != nil {
		return ErrBacklogGone
	}
	return nil
}

// Promote creates toTask (no branches) with a Later plan row and deletes the item, in one
// transaction.
func (r *AdeBacklogRepo) Promote(id string, toTask model.AdeTask) (model.AdeTask, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: begin promote ade backlog: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	res, err := tx.Exec(`DELETE FROM ade_backlog WHERE id = ?`, id)
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: delete ade backlog %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return model.AdeTask{}, ErrBacklogGone
	}
	out, err := insertTask(tx, toTask, nil)
	if err != nil {
		return model.AdeTask{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: commit promote ade backlog: %w", err)
	}
	return out, nil
}
