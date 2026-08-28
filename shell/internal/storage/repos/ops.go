package repos

import (
	"database/sql"
	"fmt"
)

// OpRecord mirrors src/shared/domain/ops.ts's opRecordSchema.
type OpRecord struct {
	ID           string  `json:"id"`
	ConnectionID *string `json:"connectionId"`
	TabID        *string `json:"tabId"`
	StartedAt    string  `json:"startedAt"`
	DurationMs   *int    `json:"durationMs"`
	Kind         string  `json:"kind"`
	Status       string  `json:"status"`
	Rows         *int    `json:"rows"`
	Command      *string `json:"command"`
	Error        *string `json:"error"`
}

type OpsRepo struct {
	DB *sql.DB
}

func (r *OpsRepo) Recent(limit int) ([]OpRecord, error) {
	rows, err := r.DB.Query(`
		SELECT id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error
		  FROM op_log
		 ORDER BY started_at DESC
		 LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("repos/ops: query: %w", err)
	}
	defer rows.Close()

	out := []OpRecord{}
	for rows.Next() {
		var (
			o                   OpRecord
			connectionID, tabID sql.NullString
			durationMs, opRows  sql.NullInt64
			command, opErr      sql.NullString
		)
		if err := rows.Scan(&o.ID, &connectionID, &tabID, &o.StartedAt, &durationMs, &o.Kind, &o.Status, &opRows, &command, &opErr); err != nil {
			return nil, fmt.Errorf("repos/ops: scan: %w", err)
		}
		// P19 legacy coercion: an op logged before the ddl->definition rename.
		if o.Kind == "ddl" {
			o.Kind = "definition"
		}
		if connectionID.Valid {
			o.ConnectionID = &connectionID.String
		}
		if tabID.Valid {
			o.TabID = &tabID.String
		}
		if durationMs.Valid {
			v := int(durationMs.Int64)
			o.DurationMs = &v
		}
		if opRows.Valid {
			v := int(opRows.Int64)
			o.Rows = &v
		}
		if command.Valid {
			o.Command = &command.String
		}
		if opErr.Valid {
			o.Error = &opErr.String
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/ops: rows: %w", err)
	}
	return out, nil
}
