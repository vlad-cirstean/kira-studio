package repos

import (
	"database/sql"
	"fmt"
	"github.com/kirathecat/kira-studio/internal/kiratime"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

const customScriptsSelectColumns = `id, name, command, working_dir, color, sort_order, created_at, updated_at`

// CustomScriptsRepo reads and writes the `custom_scripts` table (P85 §8.1) —
// CodeReposRepo's own plain shape: a selectColumns const, a scan*Row(rowScanner) helper, List
// ordered deterministically.
type CustomScriptsRepo struct {
	DB *sql.DB
}

func scanCustomScriptRow(row rowScanner) (model.CustomScript, error) {
	var s model.CustomScript
	if err := row.Scan(
		&s.ID, &s.Name, &s.Command, &s.WorkingDir, &s.Color, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return model.CustomScript{}, err
	}
	return s, nil
}

// List orders by sort_order ASC, name ASC — CodeReposRepo.List's own tiebreak.
func (r *CustomScriptsRepo) List() ([]model.CustomScript, error) {
	rows, err := r.DB.Query(`SELECT ` + customScriptsSelectColumns + ` FROM custom_scripts ORDER BY sort_order ASC, name ASC`)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.CustomScript, bool, error) {
		rec, err := scanCustomScriptRow(rows)
		return rec, true, err
	})
}

// Get reads one row by id, (nil, nil) when not found.
func (r *CustomScriptsRepo) Get(id string) (*model.CustomScript, error) {
	row := r.DB.QueryRow(`SELECT `+customScriptsSelectColumns+` FROM custom_scripts WHERE id = ?`, id)
	rec, err := scanCustomScriptRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("repos/customscripts: get %s: %w", id, err)
	}
	return &rec, nil
}

// Create inserts a new row, sort_order set to one past the current max — CodeReposRepo.Create's
// own append-at-the-end convention. fields is validated (and its name/command trimmed in place)
// before the insert.
func (r *CustomScriptsRepo) Create(fields model.CustomScriptFields) (model.CustomScript, error) {
	if err := fields.Validate(); err != nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: %w", err)
	}
	var maxOrder sql.NullInt64
	if err := r.DB.QueryRow(`SELECT MAX(sort_order) FROM custom_scripts`).Scan(&maxOrder); err != nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: max sort_order: %w", err)
	}
	now := kiratime.NowISO()
	rec := model.CustomScript{
		ID:         uuid.NewString(),
		Name:       fields.Name,
		Command:    fields.Command,
		WorkingDir: fields.WorkingDir,
		Color:      fields.Color,
		SortOrder:  int(maxOrder.Int64) + 1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if _, err := r.DB.Exec(
		`INSERT INTO custom_scripts (id, name, command, working_dir, color, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.ID, rec.Name, rec.Command, rec.WorkingDir, rec.Color, rec.SortOrder, rec.CreatedAt, rec.UpdatedAt,
	); err != nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: insert: %w", err)
	}
	return rec, nil
}

// Update writes fields onto id — name/command/workingDir/color only; id, sort_order and
// created_at are untouched. Returns a wrapped sql.ErrNoRows for an unknown id
// (ConnectionsRepo.SetMcpEnabled's own recorded fix, applied here from the start).
func (r *CustomScriptsRepo) Update(id string, fields model.CustomScriptFields) (model.CustomScript, error) {
	if err := fields.Validate(); err != nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: %w", err)
	}
	now := kiratime.NowISO()
	res, err := r.DB.Exec(
		`UPDATE custom_scripts SET name = ?, command = ?, working_dir = ?, color = ?, updated_at = ? WHERE id = ?`,
		fields.Name, fields.Command, fields.WorkingDir, fields.Color, now, id,
	)
	if err != nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: update %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: update %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: update %s: %w", id, sql.ErrNoRows)
	}
	rec, err := r.Get(id)
	if err != nil {
		return model.CustomScript{}, err
	}
	if rec == nil {
		return model.CustomScript{}, fmt.Errorf("repos/customscripts: update %s: %w", id, sql.ErrNoRows)
	}
	return *rec, nil
}

// Remove deletes one row by id. Returns a wrapped sql.ErrNoRows for an unknown id, the same rule
// Update above follows.
func (r *CustomScriptsRepo) Remove(id string) error {
	res, err := r.DB.Exec(`DELETE FROM custom_scripts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("repos/customscripts: remove %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos/customscripts: remove %s: rows affected: %w", id, err)
	}
	if n == 0 {
		return fmt.Errorf("repos/customscripts: remove %s: %w", id, sql.ErrNoRows)
	}
	return nil
}
