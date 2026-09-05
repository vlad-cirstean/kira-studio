package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// P11 D11: four caps, because a streamed call can grow in a way an HTTP response body cannot —
// the first three are P8 D6's own three (grpc_call_history is a fourth application of the same
// insert-then-trim/global-sweep pattern, following a precedent rather than duplicating an
// abstraction that exists), the fourth (maxGrpcStoredMessages) is genuinely new.
const (
	maxGrpcMessageBytes    = 64 * 1024
	maxGrpcStoredMessages  = 100
	grpcHistoryPerScopeCap = 20
)

// grpcHistoryByteBudget is D11's table-wide ceiling — a quarter of api_response_history's
// 128 MiB, since a gRPC call's stored payload is capped an order of magnitude lower (100 × 64 KiB
// worst case ≈ 6.4 MiB per entry, against api_response_history's 256 KiB) and the two budgets are
// independent. A var, not a const, only so SetGrpcHistoryByteBudgetForTest can shrink it for one
// test (mirrors response_history.go's own historyByteBudget/SetHistoryByteBudgetForTest split).
var grpcHistoryByteBudget = 32 * 1024 * 1024

type GrpcHistoryRepo struct {
	DB *sql.DB
}

// storedGrpcSnapshot is exactly what snapshot_json holds — Entry is deliberately absent, the same
// reason storedSnapshot (response_history.go) leaves it out: Get rebuilds it from the row's own
// summary columns, so there is no second copy of the same fact to drift from what List reads.
type storedGrpcSnapshot struct {
	Target         string                          `json:"target"`
	Method         string                          `json:"method"`
	Streaming      string                          `json:"streaming"`
	Message        string                          `json:"message"`
	Metadata       []model.SavedGrpcMetaRow        `json:"metadata"`
	Messages       []model.GrpcCallSnapshotMessage `json:"messages"`
	MessagesElided bool                            `json:"messagesElided"`
	Header         []model.SavedGrpcMetaRow        `json:"header"`
	Trailer        []model.SavedGrpcMetaRow        `json:"trailer"`
}

// Record is the whole storage policy (D11), in one transaction: apply the four caps, marshal,
// insert, per-scope trim, global byte sweep. The caps live here, not in bridge/grpc.go (§0.3) —
// Record is the only writer, so they cannot be bypassed by a future caller. Only a COMPLETED call
// is ever recorded (any terminal status, including non-OK and a cancellation that received
// messages) — an in-flight stream writes nothing.
func (r *GrpcHistoryRepo) Record(rec model.GrpcCallHistoryRecord) error {
	if err := rec.Validate(); err != nil {
		return err
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/grpc_history: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	environment := ""
	if rec.EnvironmentID != "" {
		if err := tx.QueryRow(
			`SELECT name FROM api_environments WHERE id = ?`, rec.EnvironmentID,
		).Scan(&environment); err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("repos/grpc_history: resolve environment: %w", err)
		}
	}

	messages := make([]model.GrpcCallSnapshotMessage, 0, len(rec.Messages))
	for _, m := range rec.Messages {
		if len(messages) >= maxGrpcStoredMessages {
			break
		}
		if len(m.JSON) > maxGrpcMessageBytes {
			m.JSON = m.JSON[:maxGrpcMessageBytes]
			m.Truncated = true
		}
		messages = append(messages, m)
	}
	// Finding 8: compared against the call's own true MessageCount, not len(rec.Messages) — the
	// caller (grpcclient.ServerStream) already bounds its own Messages slice at the identical cap
	// to keep a long-running stream's in-memory footprint flat, so the slice's length alone can no
	// longer tell an elided call apart from one that produced exactly maxGrpcStoredMessages.
	messagesElided := rec.MessageCount > maxGrpcStoredMessages

	snap := storedGrpcSnapshot{
		Target: rec.Target, Method: rec.Method, Streaming: rec.Streaming,
		Message: rec.Message, Metadata: rec.Metadata,
		Messages: messages, MessagesElided: messagesElided,
		Header: rec.Header, Trailer: rec.Trailer,
	}
	snapshotJSON, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("repos/grpc_history: encode snapshot: %w", err)
	}

	id := uuid.NewString()
	var itemID *string
	if rec.ItemID != "" {
		itemID = &rec.ItemID
	}
	calledAt := model.NowISO()
	storedBytes := len(snapshotJSON)

	if _, err := tx.Exec(
		`INSERT INTO grpc_call_history
		   (id, item_id, tab_id, called_at, target, method, streaming, environment,
		    code, code_name, status_message, elapsed_ms, message_count, message_bytes, stored_bytes, snapshot_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, itemID, rec.TabID, calledAt, rec.Target, rec.Method, rec.Streaming, environment,
		rec.Code, rec.CodeName, rec.StatusMessage, rec.ElapsedMs, rec.MessageCount, rec.MessageBytes,
		storedBytes, string(snapshotJSON),
	); err != nil {
		return fmt.Errorf("repos/grpc_history: insert: %w", err)
	}

	// Per-scope count cap — the exact shape api_response_history's own trim uses.
	scopeKey := "tab:" + rec.TabID
	if itemID != nil {
		scopeKey = *itemID
	}
	if _, err := tx.Exec(
		`DELETE FROM grpc_call_history
		  WHERE scope_key = ?
		    AND id NOT IN (SELECT id FROM grpc_call_history
		                     WHERE scope_key = ?
		                     ORDER BY called_at DESC, rowid DESC LIMIT ?)`,
		scopeKey, scopeKey, grpcHistoryPerScopeCap,
	); err != nil {
		return fmt.Errorf("repos/grpc_history: cap scope: %w", err)
	}

	// Global byte budget, oldest-first across every scope — the per-entry caps above are what
	// make this safe: no single row can exceed the budget by itself.
	if _, err := tx.Exec(
		`DELETE FROM grpc_call_history WHERE id NOT IN (
		   SELECT id FROM (
		     SELECT id, SUM(stored_bytes) OVER (ORDER BY called_at DESC, rowid DESC
		                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
		       FROM grpc_call_history
		   ) WHERE running <= ?)`,
		grpcHistoryByteBudget,
	); err != nil {
		return fmt.Errorf("repos/grpc_history: sweep budget: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/grpc_history: commit: %w", err)
	}
	return nil
}

const grpcHistoryEntryColumns = `id, item_id, tab_id, called_at, target, method, streaming, environment,
	code, code_name, status_message, elapsed_ms, message_count, message_bytes, stored_bytes`

func scanGrpcHistoryEntry(row rowScanner) (model.GrpcCallHistoryEntry, error) {
	var (
		e      model.GrpcCallHistoryEntry
		itemID sql.NullString
	)
	if err := row.Scan(
		&e.ID, &itemID, &e.TabID, &e.CalledAt, &e.Target, &e.Method, &e.Streaming, &e.Environment,
		&e.Code, &e.CodeName, &e.StatusMessage, &e.ElapsedMs, &e.MessageCount, &e.MessageBytes, &e.StoredBytes,
	); err != nil {
		return model.GrpcCallHistoryEntry{}, err
	}
	if itemID.Valid {
		e.ItemID = &itemID.String
	}
	return e, nil
}

// List is the summary projection (every column but snapshot_json), newest first — ≤
// grpcHistoryPerScopeCap by construction (Record's own trim).
func (r *GrpcHistoryRepo) List(scopeKey string) ([]model.GrpcCallHistoryEntry, error) {
	rows, err := r.DB.Query(
		`SELECT `+grpcHistoryEntryColumns+`
		   FROM grpc_call_history
		  WHERE scope_key = ?
		  ORDER BY called_at DESC, rowid DESC`,
		scopeKey,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/grpc_history: query list: %w", err)
	}
	defer rows.Close()

	out := []model.GrpcCallHistoryEntry{}
	for rows.Next() {
		e, err := scanGrpcHistoryEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/grpc_history: scan list: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/grpc_history: rows: %w", err)
	}
	return out, nil
}

// Get decodes one row's snapshot_json and rebuilds Entry from the row's own summary columns.
func (r *GrpcHistoryRepo) Get(id string) (model.GrpcCallSnapshot, error) {
	row := r.DB.QueryRow(
		`SELECT `+grpcHistoryEntryColumns+`, snapshot_json
		   FROM grpc_call_history WHERE id = ?`,
		id,
	)
	var (
		e            model.GrpcCallHistoryEntry
		itemID       sql.NullString
		snapshotJSON string
	)
	if err := row.Scan(
		&e.ID, &itemID, &e.TabID, &e.CalledAt, &e.Target, &e.Method, &e.Streaming, &e.Environment,
		&e.Code, &e.CodeName, &e.StatusMessage, &e.ElapsedMs, &e.MessageCount, &e.MessageBytes, &e.StoredBytes,
		&snapshotJSON,
	); err != nil {
		return model.GrpcCallSnapshot{}, fmt.Errorf("repos/grpc_history: get: %w", err)
	}
	if itemID.Valid {
		e.ItemID = &itemID.String
	}

	var snap storedGrpcSnapshot
	if err := json.Unmarshal([]byte(snapshotJSON), &snap); err != nil {
		return model.GrpcCallSnapshot{}, fmt.Errorf("repos/grpc_history: decode snapshot %s: %w", id, err)
	}

	return model.GrpcCallSnapshot{
		Entry: e, Target: snap.Target, Method: snap.Method, Streaming: snap.Streaming,
		Message: snap.Message, Metadata: snap.Metadata,
		Messages: snap.Messages, MessagesElided: snap.MessagesElided,
		Header: snap.Header, Trailer: snap.Trailer,
	}, nil
}

// Delete removes one entry.
func (r *GrpcHistoryRepo) Delete(id string) error {
	if _, err := r.DB.Exec(`DELETE FROM grpc_call_history WHERE id = ?`, id); err != nil {
		return fmt.Errorf("repos/grpc_history: delete: %w", err)
	}
	return nil
}

// Clear removes every entry in one scope.
func (r *GrpcHistoryRepo) Clear(scopeKey string) error {
	if _, err := r.DB.Exec(`DELETE FROM grpc_call_history WHERE scope_key = ?`, scopeKey); err != nil {
		return fmt.Errorf("repos/grpc_history: clear: %w", err)
	}
	return nil
}

// Adopt moves a scratch tab's history onto a newly-saved request (mirrors
// response_history.go's own D14) — one UPDATE, scope follows via the generated column.
func (r *GrpcHistoryRepo) Adopt(tabID, itemID string) (int, error) {
	res, err := r.DB.Exec(
		`UPDATE grpc_call_history SET item_id = ? WHERE item_id IS NULL AND tab_id = ?`,
		itemID, tabID,
	)
	if err != nil {
		return 0, fmt.Errorf("repos/grpc_history: adopt: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("repos/grpc_history: adopt rows affected: %w", err)
	}
	return int(n), nil
}

// SweepOrphans deletes a scratch tab's history once its tab is gone — run once at launch beside
// response_history's own startup prune (mirrors D7).
func (r *GrpcHistoryRepo) SweepOrphans() error {
	if _, err := r.DB.Exec(
		`DELETE FROM grpc_call_history
		  WHERE item_id IS NULL AND tab_id NOT IN (SELECT id FROM tabs)`,
	); err != nil {
		return fmt.Errorf("repos/grpc_history: sweep orphans: %w", err)
	}
	return nil
}
