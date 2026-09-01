package repos

import (
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// hardCapRows mirrors ops.ts's HARD_CAP_ROWS.
const hardCapRows = 20_000

const (
	opsInsertSQL = `INSERT INTO op_log (id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error)
		 VALUES (?, ?, ?, ?, NULL, ?, 'running', NULL, NULL, NULL)`
	opsUpdateSQL = `UPDATE op_log SET status = ?, duration_ms = ?, rows = ?, command = ?, error = ? WHERE id = ?`
)

type OpsRepo struct {
	DB *sql.DB

	// insert and update are prepared once by repos.New (P52 §5.4 names "op-log append/finish"
	// among the hot statements); nil when constructed directly, which falls back to an ad-hoc
	// exec with identical SQL.
	insert *sql.Stmt
	update *sql.Stmt
}

// Append inserts a new running op row (ops.ts's appendOp).
func (r *OpsRepo) Append(op model.OpAppend) error {
	var err error
	if r.insert != nil {
		_, err = r.insert.Exec(op.ID, op.ConnectionID, op.TabID, op.StartedAt, op.Kind)
	} else {
		_, err = r.DB.Exec(opsInsertSQL, op.ID, op.ConnectionID, op.TabID, op.StartedAt, op.Kind)
	}
	if err != nil {
		return fmt.Errorf("repos/ops: append %s: %w", op.ID, err)
	}
	return nil
}

// Finish records a running op's terminal state (ops.ts's finishOp).
func (r *OpsRepo) Finish(opID string, patch model.OpFinish) error {
	var err error
	if r.update != nil {
		_, err = r.update.Exec(patch.Status, patch.DurationMs, patch.Rows, patch.Command, patch.Error, opID)
	} else {
		_, err = r.DB.Exec(opsUpdateSQL, patch.Status, patch.DurationMs, patch.Rows, patch.Command, patch.Error, opID)
	}
	if err != nil {
		return fmt.Errorf("repos/ops: finish %s: %w", opID, err)
	}
	return nil
}

// Recent mirrors ops.ts's recentOps. There is no 'ddl'->'definition' coercion here (P52 §4.3 /
// P53 §3.1: it existed only for rows written before P19, and a fresh kira.db cannot contain
// one) — an unrecognised kind or status is simply dropped, logged, like any other bad row.
func (r *OpsRepo) Recent(limit int) ([]model.OpRecord, error) {
	rows, err := r.DB.Query(`
		SELECT id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error
		  FROM op_log
		 ORDER BY started_at DESC, rowid DESC
		 LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("repos/ops: query: %w", err)
	}
	defer rows.Close()

	out := []model.OpRecord{}
	for rows.Next() {
		var (
			o                   model.OpRecord
			connectionID, tabID sql.NullString
			durationMs, opRows  sql.NullInt64
			command, opErr      sql.NullString
		)
		if err := rows.Scan(&o.ID, &connectionID, &tabID, &o.StartedAt, &durationMs, &o.Kind, &o.Status, &opRows, &command, &opErr); err != nil {
			return nil, fmt.Errorf("repos/ops: scan: %w", err)
		}
		if !model.ValidOpKind(o.Kind) {
			slog.Warn("dropping op_log row: unrecognised kind", "scope", "storage/ops", "id", o.ID, "kind", o.Kind)
			continue
		}
		if !model.ValidOpStatus(o.Status) {
			slog.Warn("dropping op_log row: unrecognised status", "scope", "storage/ops", "id", o.ID, "status", o.Status)
			continue
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

// Prune mirrors ops.ts's pruneOps: a retention-days cut, then a hard cap on total row count.
// P52 §5.4's rewrite — both passes are a single DELETE with a subquery, never per-call-shape SQL.
func (r *OpsRepo) Prune(retentionDays int) error {
	cutoff := model.FormatISO(time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour))
	if _, err := r.DB.Exec(`DELETE FROM op_log WHERE started_at < ?`, cutoff); err != nil {
		return fmt.Errorf("repos/ops: prune retention cut: %w", err)
	}
	if _, err := r.DB.Exec(`
		DELETE FROM op_log
		 WHERE id NOT IN (
		   SELECT id FROM op_log ORDER BY started_at DESC, rowid DESC LIMIT ?
		 )
	`, hardCapRows); err != nil {
		return fmt.Errorf("repos/ops: prune hard cap: %w", err)
	}
	return nil
}
