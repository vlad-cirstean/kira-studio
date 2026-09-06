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

// P23 D1: op_log already had a count bound (hardCapRows) and an age bound (the retention cut
// below) — these two close the gap, mirroring api_response_history/grpc_call_history's own shape
// (F2) rather than inventing a fifth.
const (
	// maxOpCommandBytes is grpc_history.go's maxGrpcMessageBytes verbatim (D1(a)): an op-log
	// command is one label among as many as hardCapRows, worth less than a stored gRPC message a
	// user opens and reads. It is also the largest cap that keeps the table under roughly twice
	// its budget between two prunes (pruneEveryOps * (maxOpCommandBytes + maxOpErrorBytes) ≈ one
	// budget of overshoot on top of one budget).
	maxOpCommandBytes = 64 * 1024
	// maxOpErrorBytes is httpclient/timeline.go's maxHopHeaderBytes (D1(b)) — this app's existing
	// answer for "a block of machine-generated text worth keeping in full". Truncation here is
	// silent, with no flag: nothing in the app acts on error (F5), only renders and searches it.
	maxOpErrorBytes = 8 * 1024
)

// opLogByteBudget is D2's table-wide ceiling — grpc_history.go's own grpcHistoryByteBudget
// verbatim (P11 D11's argument: a quarter of api_response_history's 128 MiB, for a table of
// machine-generated labels rather than results a person asked for). A var, not a const, only so
// SetOpLogByteBudgetForTest (ops_internal_test.go) can shrink it for one test, mirroring
// response_history.go's/grpc_history.go's own historyByteBudget/grpcHistoryByteBudget split.
var opLogByteBudget = 32 * 1024 * 1024

const (
	opsInsertSQL = `INSERT INTO op_log (id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error)
		 VALUES (?, ?, ?, ?, NULL, ?, 'running', NULL, NULL, NULL)`
	opsUpdateSQL = `UPDATE op_log SET status = ?, duration_ms = ?, rows = ?, command = ?, error = ?, stored_bytes = ?, command_truncated = ? WHERE id = ?`
)

type OpsRepo struct {
	DB *sql.DB

	// insert and update are prepared once by repos.New (P52 §5.4 names "op-log append/finish"
	// among the hot statements); nil when constructed directly, which falls back to an ad-hoc
	// exec with identical SQL.
	insert *sql.Stmt
	update *sql.Stmt
}

// Append inserts a new running op row (ops.ts's appendOp). stored_bytes/command_truncated take
// their column defaults (0) — a running op has no command or error yet.
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

// Finish records a running op's terminal state (ops.ts's finishOp), applying D1(a)/(b)'s per-row
// caps first. patch is a pointer so it is truncated in place: the caller (oplog.Wiring) builds its
// live-update record from the same patch it just passed in, rather than from the pre-truncation
// event payload, so a push and a subsequent reload never disagree about what was actually stored.
// The returned bool is D1(c)'s command_truncated flag.
func (r *OpsRepo) Finish(opID string, patch *model.OpFinish) (commandTruncated bool, err error) {
	if patch.Command != nil && len(*patch.Command) > maxOpCommandBytes {
		truncated := (*patch.Command)[:maxOpCommandBytes]
		patch.Command = &truncated
		commandTruncated = true
	}
	if patch.Error != nil && len(*patch.Error) > maxOpErrorBytes {
		truncated := (*patch.Error)[:maxOpErrorBytes]
		patch.Error = &truncated
	}
	storedBytes := 0
	if patch.Command != nil {
		storedBytes += len(*patch.Command)
	}
	if patch.Error != nil {
		storedBytes += len(*patch.Error)
	}

	if r.update != nil {
		_, err = r.update.Exec(patch.Status, patch.DurationMs, patch.Rows, patch.Command, patch.Error, storedBytes, boolToInt(commandTruncated), opID)
	} else {
		_, err = r.DB.Exec(opsUpdateSQL, patch.Status, patch.DurationMs, patch.Rows, patch.Command, patch.Error, storedBytes, boolToInt(commandTruncated), opID)
	}
	if err != nil {
		return false, fmt.Errorf("repos/ops: finish %s: %w", opID, err)
	}
	return commandTruncated, nil
}

// Recent mirrors ops.ts's recentOps. There is no 'ddl'->'definition' coercion here (P52 §4.3 /
// P53 §3.1: it existed only for rows written before P19, and a fresh kira.db cannot contain
// one) — an unrecognised kind or status is simply dropped, logged, like any other bad row.
func (r *OpsRepo) Recent(limit int) ([]model.OpRecord, error) {
	rows, err := r.DB.Query(`
		SELECT id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error, command_truncated
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
			commandTruncated    int
		)
		if err := rows.Scan(&o.ID, &connectionID, &tabID, &o.StartedAt, &durationMs, &o.Kind, &o.Status, &opRows, &command, &opErr, &commandTruncated); err != nil {
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
		o.CommandTruncated = commandTruncated != 0
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/ops: rows: %w", err)
	}
	return out, nil
}

// Prune mirrors ops.ts's pruneOps: a retention-days cut, then a hard cap on total row count, then
// D2's table-wide byte budget — cheapest and most selective pass first, each shrinking the input
// the next pass has to consider. P52 §5.4's rewrite — every pass is a single DELETE with a
// subquery, never per-call-shape SQL.
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

	// D2: a table-wide byte budget, oldest-first — response_history.go's/grpc_history.go's own
	// sweep transposed onto op_log, gated behind the op_log_bytes covering index
	// (0015_p23_op_log_bytes.sql) so the expensive window-function DELETE is skipped whenever the
	// table is nowhere near budget. Safe only because D1(a)/(b)'s per-row caps hold: no single row
	// can exceed 64 KiB + 8 KiB, three orders of magnitude under half the budget, so the row that
	// triggered this prune (if any) is never itself evicted.
	//
	// Why here rather than on every Append/Finish: op_log gets a row for every database operation
	// the app performs, not a user-initiated send — putting a SUM plus a window-function DELETE in
	// front of all of them would be strictly worse than the exact regression P21 round 3 finding 11
	// caught on the other two history tables. Prune already runs at launch and every 500 completed
	// ops (oplog/wire.go), and the overshoot that cadence permits is bounded by construction: D1's
	// 64 KiB cap was derived from exactly that arithmetic.
	var totalBytes int64
	if err := r.DB.QueryRow(`SELECT COALESCE(SUM(stored_bytes), 0) FROM op_log`).Scan(&totalBytes); err != nil {
		return fmt.Errorf("repos/ops: sum stored_bytes: %w", err)
	}
	if totalBytes > int64(opLogByteBudget) {
		if _, err := r.DB.Exec(`
			DELETE FROM op_log WHERE id NOT IN (
			  SELECT id FROM (
			    SELECT id, SUM(stored_bytes) OVER (ORDER BY started_at DESC, rowid DESC
			                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
			      FROM op_log
			  ) WHERE running <= ?)
		`, opLogByteBudget); err != nil {
			return fmt.Errorf("repos/ops: prune byte budget: %w", err)
		}
	}
	return nil
}
