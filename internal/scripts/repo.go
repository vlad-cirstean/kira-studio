package scripts

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

type rowScanner interface {
	Scan(dest ...any) error
}

const selectColumns = `id, name, command, working_dir, dir_mode, color, collection_id, sort_order, created_at, updated_at`

// Repo reads and writes the `custom_scripts` table, List ordered deterministically.
type Repo struct {
	DB *sql.DB
}

func scanRow(row rowScanner) (CustomScript, error) {
	var s CustomScript
	var collectionID sql.NullString
	if err := row.Scan(
		&s.ID, &s.Name, &s.Command, &s.WorkingDir, &s.DirMode, &s.Color, &collectionID, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return CustomScript{}, err
	}
	if collectionID.Valid {
		s.CollectionID = &collectionID.String
	}
	return s, nil
}

// List orders by sort_order, name for a stable, deterministic tiebreak.
func (r *Repo) List() ([]CustomScript, error) {
	rows, err := r.DB.Query(`SELECT ` + selectColumns + ` FROM custom_scripts ORDER BY sort_order ASC, name ASC`)
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
		return nil, fmt.Errorf("scripts: get %s: %w", id, err)
	}
	return rec, nil
}

// Create inserts a new row, sort_order set to one past the current max — sqlitex.NextSortOrder's
// own append-at-the-end convention. fields is validated (and its name/command trimmed in place)
// before the insert.
func (r *Repo) Create(fields CustomScriptFields) (CustomScript, error) {
	if err := fields.Validate(); err != nil {
		return CustomScript{}, fmt.Errorf("scripts: %w", err)
	}
	if fields.DirMode == DirModeHome {
		return CustomScript{}, errHomeRetired
	}
	if err := r.requireCollection(fields.CollectionID); err != nil {
		return CustomScript{}, err
	}
	sortOrder, err := sqlitex.NextSortOrder(r.DB, "custom_scripts", "")
	if err != nil {
		return CustomScript{}, fmt.Errorf("scripts: next sort order: %w", err)
	}
	now := kiratime.NowISO()
	rec := CustomScript{
		ID:           uuid.NewString(),
		Name:         fields.Name,
		Command:      fields.Command,
		WorkingDir:   fields.WorkingDir,
		DirMode:      fields.DirMode,
		Color:        fields.Color,
		CollectionID: fields.CollectionID,
		SortOrder:    sortOrder,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, err := r.DB.Exec(
		`INSERT INTO custom_scripts (id, name, command, working_dir, dir_mode, color, collection_id, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.ID, rec.Name, rec.Command, rec.WorkingDir, rec.DirMode, rec.Color, rec.CollectionID, rec.SortOrder, rec.CreatedAt, rec.UpdatedAt,
	); err != nil {
		return CustomScript{}, fmt.Errorf("scripts: insert: %w", err)
	}
	return rec, nil
}

// Update writes fields onto id — name/command/workingDir/color/collection only; id, sort_order and
// created_at are untouched. Returns a wrapped sql.ErrNoRows for an unknown id
// (ConnectionsRepo.SetMcpEnabled's own recorded fix, applied here from the start).
func (r *Repo) Update(id string, fields CustomScriptFields) (CustomScript, error) {
	if err := fields.Validate(); err != nil {
		return CustomScript{}, fmt.Errorf("scripts: %w", err)
	}
	if err := r.requireCollection(fields.CollectionID); err != nil {
		return CustomScript{}, err
	}
	if fields.DirMode == DirModeHome {
		cur, err := r.Get(id)
		if err != nil {
			return CustomScript{}, err
		}
		if cur != nil && cur.DirMode != DirModeHome {
			return CustomScript{}, errHomeRetired
		}
	}
	now := kiratime.NowISO()
	res, err := r.DB.Exec(
		`UPDATE custom_scripts SET name = ?, command = ?, working_dir = ?, dir_mode = ?, color = ?, collection_id = ?, updated_at = ? WHERE id = ?`,
		fields.Name, fields.Command, fields.WorkingDir, fields.DirMode, fields.Color, fields.CollectionID, now, id,
	)
	if err != nil {
		return CustomScript{}, fmt.Errorf("scripts: update %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return CustomScript{}, fmt.Errorf("scripts: update %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return CustomScript{}, fmt.Errorf("scripts: update %s: %w", id, sql.ErrNoRows)
	}
	rec, err := r.Get(id)
	if err != nil {
		return CustomScript{}, err
	}
	if rec == nil {
		return CustomScript{}, fmt.Errorf("scripts: update %s: %w", id, sql.ErrNoRows)
	}
	return *rec, nil
}

// Remove deletes one row by id. Returns a wrapped sql.ErrNoRows for an unknown id, the same rule
// Update above follows.
func (r *Repo) Remove(id string) error {
	res, err := r.DB.Exec(`DELETE FROM custom_scripts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("scripts: remove %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("scripts: remove %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return fmt.Errorf("scripts: remove %s: %w", id, sql.ErrNoRows)
	}
	return nil
}

// requireCollection refuses a non-nil id that names no custom_script_collections row.
func (r *Repo) requireCollection(id *string) error {
	if id == nil {
		return nil
	}
	var one int
	err := r.DB.QueryRow(`SELECT 1 FROM custom_script_collections WHERE id = ?`, *id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return invalid("scripts: no such collection")
	}
	if err != nil {
		return fmt.Errorf("scripts: check collection %s: %w", *id, err)
	}
	return nil
}

// Move sets (nil clears) one command's collection. Returns a wrapped sql.ErrNoRows for an unknown
// command id.
func (r *Repo) Move(id string, collectionID *string) error {
	if err := r.requireCollection(collectionID); err != nil {
		return err
	}
	res, err := r.DB.Exec(
		`UPDATE custom_scripts SET collection_id = ?, updated_at = ? WHERE id = ?`,
		collectionID, kiratime.NowISO(), id,
	)
	if err != nil {
		return fmt.Errorf("scripts: move %s: %w", id, err)
	}
	return requireRow(res, "move", id)
}

const collectionColumns = `id, name, sort_order, created_at, updated_at`

func scanCollection(row rowScanner) (Collection, error) {
	var c Collection
	err := row.Scan(&c.ID, &c.Name, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

// ListCollections orders by sort_order, name (creation order, name as the tiebreak).
func (r *Repo) ListCollections() ([]Collection, error) {
	rows, err := r.DB.Query(`SELECT ` + collectionColumns + ` FROM custom_script_collections ORDER BY sort_order ASC, name ASC`)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (Collection, bool, error) {
		c, err := scanCollection(rows)
		return c, true, err
	})
}

// CreateCollection appends a collection at the end of the order.
func (r *Repo) CreateCollection(name string) (Collection, error) {
	name, err := validCollectionName(name)
	if err != nil {
		return Collection{}, err
	}
	sortOrder, err := sqlitex.NextSortOrder(r.DB, "custom_script_collections", "")
	if err != nil {
		return Collection{}, fmt.Errorf("scripts: next collection sort order: %w", err)
	}
	now := kiratime.NowISO()
	c := Collection{ID: uuid.NewString(), Name: name, SortOrder: sortOrder, CreatedAt: now, UpdatedAt: now}
	if _, err := r.DB.Exec(
		`INSERT INTO custom_script_collections (`+collectionColumns+`) VALUES (?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.SortOrder, c.CreatedAt, c.UpdatedAt,
	); err != nil {
		return Collection{}, fmt.Errorf("scripts: insert collection: %w", err)
	}
	return c, nil
}

// RenameCollection renames one collection. Returns a wrapped sql.ErrNoRows for an unknown id.
func (r *Repo) RenameCollection(id, name string) error {
	name, err := validCollectionName(name)
	if err != nil {
		return err
	}
	res, err := r.DB.Exec(
		`UPDATE custom_script_collections SET name = ?, updated_at = ? WHERE id = ?`,
		name, kiratime.NowISO(), id,
	)
	if err != nil {
		return fmt.Errorf("scripts: rename collection %s: %w", id, err)
	}
	return requireRow(res, "rename collection", id)
}

// DeleteCollection removes a collection; the foreign key cascades to its commands. Returns a
// wrapped sql.ErrNoRows for an unknown id.
func (r *Repo) DeleteCollection(id string) error {
	res, err := r.DB.Exec(`DELETE FROM custom_script_collections WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("scripts: delete collection %s: %w", id, err)
	}
	return requireRow(res, "delete collection", id)
}

func requireRow(res sql.Result, op, id string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("scripts: %s %s: rows affected: %w", op, id, err)
	}
	if n == 0 {
		return fmt.Errorf("scripts: %s %s: %w", op, id, sql.ErrNoRows)
	}
	return nil
}
