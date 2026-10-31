package repos

import (
	"fmt"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
)

var _ oplog.ForeignStore = (*OpLogRepo)(nil)

// DataVersion moves only when another connection commits; the app's handle is one connection.
func (r *OpLogRepo) DataVersion() (int64, error) {
	var v int64
	if err := r.DB.QueryRow(`PRAGMA data_version`).Scan(&v); err != nil {
		return 0, fmt.Errorf("repos: data_version: %w", err)
	}
	return v, nil
}

// MaxRowID returns the newest op_log rowid, 0 for an empty table.
func (r *OpLogRepo) MaxRowID() (int64, error) {
	var v int64
	if err := r.DB.QueryRow(`SELECT COALESCE(MAX(rowid), 0) FROM op_log`).Scan(&v); err != nil {
		return 0, fmt.Errorf("repos: max op rowid: %w", err)
	}
	return v, nil
}

// ForeignAfter returns rows written by another process (their id holds a '.') with a rowid past
// rowid or an id in ids, oldest first, and the newest rowid seen (rowid when none is newer).
func (r *OpLogRepo) ForeignAfter(rowid int64, ids []string) ([]oplog.Record, int64, error) {
	q := `SELECT rowid, ` + opColumns + `
		FROM op_log WHERE instr(id, '.') > 0 AND (rowid > ?`
	args := []any{rowid}
	if len(ids) > 0 {
		q += ` OR id IN (?` + strings.Repeat(`,?`, len(ids)-1) + `)`
		for _, id := range ids {
			args = append(args, id)
		}
	}
	rows, err := r.DB.Query(q+`) ORDER BY rowid`, args...)
	if err != nil {
		return nil, rowid, fmt.Errorf("repos: list foreign ops: %w", err)
	}
	defer rows.Close()
	out, top := []oplog.Record{}, rowid
	for rows.Next() {
		rec, rid, err := scanOp(rows, true)
		if err != nil {
			return nil, rowid, err
		}
		top = max(top, rid)
		out = append(out, rec)
	}
	return out, top, rows.Err()
}

// RunningForeignIDs lists the ids of foreign rows still marked running.
func (r *OpLogRepo) RunningForeignIDs() ([]string, error) {
	rows, err := r.DB.Query(`SELECT id FROM op_log WHERE status = 'running' AND instr(id, '.') > 0`)
	if err != nil {
		return nil, fmt.Errorf("repos: list running foreign ops: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("repos: scan running foreign op: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// FailRunning turns the rows among ids that are still running into errors carrying msg.
func (r *OpLogRepo) FailRunning(ids []string, msg string) error {
	if len(ids) == 0 {
		return nil
	}
	args := []any{msg, time.Now().UnixMilli()}
	for _, id := range ids {
		args = append(args, id)
	}
	_, err := r.DB.Exec(`UPDATE op_log SET status = 'error', error = ?, duration_ms = MAX(0, ? - started_ms)
		WHERE status = 'running' AND id IN (?`+strings.Repeat(`,?`, len(ids)-1)+`)`, args...)
	if err != nil {
		return fmt.Errorf("repos: fail running ops: %w", err)
	}
	return nil
}
