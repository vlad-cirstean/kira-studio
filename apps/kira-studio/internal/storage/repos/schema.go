package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// SchemaRepo reads and writes the `connection_ddl` table (P18 v1.1 D2) — one row per connection,
// absent until the user writes one. Modelled on FiltersRepo: a single upsert rather than the
// delete-all-then-insert dance Filters.Replace needs, since this table has exactly one row per
// connection instead of a set of rows.
type SchemaRepo struct {
	DB *sql.DB
}

func (r *SchemaRepo) Get(connectionID string) (model.ConnectionDDL, error) {
	out := model.ConnectionDDL{ConnectionID: connectionID}
	err := r.DB.QueryRow(
		`SELECT ddl, updated_at FROM connection_ddl WHERE connection_id = ?`, connectionID,
	).Scan(&out.DDL, &out.UpdatedAt)
	if err == sql.ErrNoRows {
		return out, nil // D2: absent until the user writes one — not an error.
	}
	if err != nil {
		return model.ConnectionDDL{}, fmt.Errorf("repos/schema: query: %w", err)
	}
	return out, nil
}

func (r *SchemaRepo) Set(connectionID, ddl string) (model.ConnectionDDL, error) {
	out := model.ConnectionDDL{ConnectionID: connectionID, DDL: ddl, UpdatedAt: model.NowISO()}
	if _, err := r.DB.Exec(
		`INSERT INTO connection_ddl (connection_id, ddl, updated_at) VALUES (?, ?, ?)
		   ON CONFLICT(connection_id) DO UPDATE SET ddl = excluded.ddl, updated_at = excluded.updated_at`,
		connectionID, out.DDL, out.UpdatedAt,
	); err != nil {
		return model.ConnectionDDL{}, fmt.Errorf("repos/schema: upsert: %w", err)
	}
	return out, nil
}
