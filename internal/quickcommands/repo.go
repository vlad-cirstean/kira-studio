package quickcommands

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

type rowScanner interface {
	Scan(dest ...any) error
}

const selectColumns = `id, name, command, working_dir, color, collection, sort_order, created_at, updated_at`

// Repo reads and writes the `custom_scripts` table, List ordered deterministically.
type Repo struct {
	DB *sql.DB
}

func scanRow(row rowScanner) (CustomScript, error) {
	var s CustomScript
	if err := row.Scan(
		&s.ID, &s.Name, &s.Command, &s.WorkingDir, &s.Color, &s.Collection, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return CustomScript{}, err
	}
	return s, nil
}

// List orders by collection, sort_order, name for a stable, deterministic tiebreak.
func (r *Repo) List() ([]CustomScript, error) {
	rows, err := r.DB.Query(`SELECT ` + selectColumns + ` FROM custom_scripts ORDER BY collection ASC, sort_order ASC, name ASC`)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (CustomScript, bool, error) {
		rec, err := scanRow(rows)
		return rec, true, err
	})
}

// Get reads one row by id, (nil, nil) when not found.
func (r *Repo) Get(id string) (*CustomScript, error) {
	rec, err := sqlitex.QueryOne(r.DB, func(row *sql.Row) (*CustomScript, error) {
		s, err := scanRow(row)
		if err != nil {
			return nil, err
		}
		return &s, nil
	}, `SELECT `+selectColumns+` FROM custom_scripts WHERE id = ?`, id)
	if err != nil {
		return nil, fmt.Errorf("quickcommands: get %s: %w", id, err)
	}
	return rec, nil
}

// Create inserts a new row, sort_order set to one past the current max — sqlitex.NextSortOrder's
// own append-at-the-end convention. fields is validated (and its name/command trimmed in place)
// before the insert.
func (r *Repo) Create(fields CustomScriptFields) (CustomScript, error) {
	if err := fields.Validate(); err != nil {
		return CustomScript{}, fmt.Errorf("quickcommands: %w", err)
	}
	sortOrder, err := sqlitex.NextSortOrder(r.DB, "custom_scripts", "")
	if err != nil {
		return CustomScript{}, fmt.Errorf("quickcommands: next sort order: %w", err)
	}
	now := kiratime.NowISO()
	rec := CustomScript{
		ID:         uuid.NewString(),
		Name:       fields.Name,
		Command:    fields.Command,
		WorkingDir: fields.WorkingDir,
		Color:      fields.Color,
		Collection: fields.Collection,
		SortOrder:  sortOrder,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if _, err := r.DB.Exec(
		`INSERT INTO custom_scripts (id, name, command, working_dir, color, collection, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.ID, rec.Name, rec.Command, rec.WorkingDir, rec.Color, rec.Collection, rec.SortOrder, rec.CreatedAt, rec.UpdatedAt,
	); err != nil {
		return CustomScript{}, fmt.Errorf("quickcommands: insert: %w", err)
	}
	return rec, nil
}

// Update writes fields onto id — name/command/workingDir/color/collection only; id, sort_order and
// created_at are untouched. Returns a wrapped sql.ErrNoRows for an unknown id
// (ConnectionsRepo.SetMcpEnabled's own recorded fix, applied here from the start).
func (r *Repo) Update(id string, fields CustomScriptFields) (CustomScript, error) {
	if err := fields.Validate(); err != nil {
		return CustomScript{}, fmt.Errorf("quickcommands: %w", err)
	}
	now := kiratime.NowISO()
	res, err := r.DB.Exec(
		`UPDATE custom_scripts SET name = ?, command = ?, working_dir = ?, color = ?, collection = ?, updated_at = ? WHERE id = ?`,
		fields.Name, fields.Command, fields.WorkingDir, fields.Color, fields.Collection, now, id,
	)
	if err != nil {
		return CustomScript{}, fmt.Errorf("quickcommands: update %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return CustomScript{}, fmt.Errorf("quickcommands: update %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return CustomScript{}, fmt.Errorf("quickcommands: update %s: %w", id, sql.ErrNoRows)
	}
	rec, err := r.Get(id)
	if err != nil {
		return CustomScript{}, err
	}
	if rec == nil {
		return CustomScript{}, fmt.Errorf("quickcommands: update %s: %w", id, sql.ErrNoRows)
	}
	return *rec, nil
}

// Remove deletes one row by id. Returns a wrapped sql.ErrNoRows for an unknown id, the same rule
// Update above follows.
func (r *Repo) Remove(id string) error {
	res, err := r.DB.Exec(`DELETE FROM custom_scripts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("quickcommands: remove %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("quickcommands: remove %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return fmt.Errorf("quickcommands: remove %s: %w", id, sql.ErrNoRows)
	}
	return nil
}
