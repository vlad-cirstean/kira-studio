package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// D6: three caps, because three independent things can grow (F6) — bytes per entry, count per
// scope, and bytes across the whole table. maxHistoryBodyBytes applies once to the response body
// and once to the request body (D5); historyPerScopeLimit mirrors filter_history.go's/
// variables.go's own per-scope count cap.
const (
	maxHistoryBodyBytes  = 256 * 1024
	historyPerScopeLimit = 20
)

// historyByteBudget is D6's table-wide ceiling — the same order of magnitude as
// cache.l2BudgetMb's own budget, deliberately. A var, not a const, only so
// SetHistoryByteBudgetForTest (response_history_internal_test.go) can shrink it for one test —
// §6.2's cross-scope eviction case, which needs Record's own real sweep to fire without
// reproducing 128 MiB of real rows. Every real caller only ever reads it.
var historyByteBudget = 128 * 1024 * 1024

type ResponseHistoryRepo struct {
	DB *sql.DB
}

// storedSnapshot is exactly what snapshot_json holds — Entry is deliberately absent (D4's Get
// rebuilds it from the row's own summary columns instead, so there is no second copy of the same
// fact to drift from the columns a List projection already reads).
type storedSnapshot struct {
	Request                     model.ResponseHistoryRequest `json:"request"`
	Response                    httpclient.Response          `json:"response"`
	BodyStored                  bool                         `json:"bodyStored"`
	BodyStorageTruncated        bool                         `json:"bodyStorageTruncated"`
	RequestBodyStorageTruncated bool                         `json:"requestBodyStorageTruncated"`
}

// Record is the whole storage policy (D4/D5/D6), in one transaction: resolve the environment
// name, apply the two body rules, marshal, insert, per-scope trim, global byte sweep. The three
// caps live here, not in bridge/http.go (§0.3) — Record is the only writer, so they cannot be
// bypassed by a future caller.
func (r *ResponseHistoryRepo) Record(rec model.ResponseHistoryRecord) error {
	if err := rec.Validate(); err != nil {
		return err
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/response_history: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	environment := ""
	if rec.EnvironmentID != "" {
		if err := tx.QueryRow(
			`SELECT name FROM http_environments WHERE id = ?`, rec.EnvironmentID,
		).Scan(&environment); err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("repos/response_history: resolve environment: %w", err)
		}
	}

	reqBody, requestBodyStorageTruncated := capBody(rec.Body)
	resp := rec.Response
	bodyStored := resp.BodyEncoding != "base64"
	bodyStorageTruncated := false
	if bodyStored {
		if len(resp.Body) > maxHistoryBodyBytes {
			resp.Body = resp.Body[:maxHistoryBodyBytes]
			bodyStorageTruncated = true
		}
	} else {
		// D5 rule 2: a binary body is not stored at all — every other field (including
		// BodyBytes, F10's "412 KB of binary data") stays intact.
		resp.Body = ""
	}

	snap := storedSnapshot{
		Request: model.ResponseHistoryRequest{
			Method:  rec.Method,
			URL:     rec.URL,
			Headers: rec.Headers,
			Body:    reqBody,
		},
		Response:                    resp,
		BodyStored:                  bodyStored,
		BodyStorageTruncated:        bodyStorageTruncated,
		RequestBodyStorageTruncated: requestBodyStorageTruncated,
	}
	snapshotJSON, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("repos/response_history: encode snapshot: %w", err)
	}

	id := uuid.NewString()
	var itemID *string
	if rec.ItemID != "" {
		itemID = &rec.ItemID
	}
	scopeKey := "tab:" + rec.TabID
	if itemID != nil {
		scopeKey = *itemID
	}
	sentAt := model.NowISO()
	storedBytes := len(snapshotJSON)

	if _, err := tx.Exec(
		`INSERT INTO http_response_history
		   (id, item_id, tab_id, sent_at, method, url, environment, status, status_text,
		    elapsed_ms, body_bytes, stored_bytes, snapshot_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, itemID, rec.TabID, sentAt, rec.Method, rec.URL, environment,
		rec.Response.Status, rec.Response.StatusText, rec.Response.ElapsedMs,
		rec.Response.BodyBytes, storedBytes, string(snapshotJSON),
	); err != nil {
		return fmt.Errorf("repos/response_history: insert: %w", err)
	}

	// Per-scope count cap — the exact shape filter_history.go/variables.go's own trim uses.
	if _, err := tx.Exec(
		`DELETE FROM http_response_history
		  WHERE scope_key = ?
		    AND id NOT IN (SELECT id FROM http_response_history
		                     WHERE scope_key = ?
		                     ORDER BY sent_at DESC, rowid DESC LIMIT ?)`,
		scopeKey, scopeKey, historyPerScopeLimit,
	); err != nil {
		return fmt.Errorf("repos/response_history: cap scope: %w", err)
	}

	// Global byte budget, oldest-first across every scope (F7). The per-entry cap above is what
	// makes this safe: no single row can exceed the budget, so the row just inserted is never
	// itself evicted.
	if _, err := tx.Exec(
		`DELETE FROM http_response_history WHERE id NOT IN (
		   SELECT id FROM (
		     SELECT id, SUM(stored_bytes) OVER (ORDER BY sent_at DESC, rowid DESC
		                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
		       FROM http_response_history
		   ) WHERE running <= ?)`,
		historyByteBudget,
	); err != nil {
		return fmt.Errorf("repos/response_history: sweep budget: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/response_history: commit: %w", err)
	}
	return nil
}

// capBody applies D5's per-entry byte cap to whichever member of Body actually carries free-form
// text — 'raw' and 'code' are the only two modes whose single string can be arbitrarily long;
// urlencoded/formdata are structured field lists (small in practice) and 'file' carries a local
// path, never bytes, on the wire.
func capBody(b httpclient.Body) (httpclient.Body, bool) {
	switch b.Mode {
	case "raw":
		if len(b.Raw) > maxHistoryBodyBytes {
			b.Raw = b.Raw[:maxHistoryBodyBytes]
			return b, true
		}
	case "code":
		if len(b.Code) > maxHistoryBodyBytes {
			b.Code = b.Code[:maxHistoryBodyBytes]
			return b, true
		}
	}
	return b, false
}

const responseHistoryEntryColumns = `id, item_id, tab_id, sent_at, method, url, environment,
	status, status_text, elapsed_ms, body_bytes, stored_bytes`

func scanResponseHistoryEntry(row rowScanner) (model.ResponseHistoryEntry, error) {
	var (
		e      model.ResponseHistoryEntry
		itemID sql.NullString
	)
	if err := row.Scan(
		&e.ID, &itemID, &e.TabID, &e.SentAt, &e.Method, &e.URL, &e.Environment,
		&e.Status, &e.StatusText, &e.ElapsedMs, &e.BodyBytes, &e.StoredBytes,
	); err != nil {
		return model.ResponseHistoryEntry{}, err
	}
	if itemID.Valid {
		e.ItemID = &itemID.String
	}
	return e, nil
}

// List is the summary projection (every column but snapshot_json), newest first — ≤
// historyPerScopeLimit by construction (Record's own trim).
func (r *ResponseHistoryRepo) List(scopeKey string) ([]model.ResponseHistoryEntry, error) {
	rows, err := r.DB.Query(
		`SELECT `+responseHistoryEntryColumns+`
		   FROM http_response_history
		  WHERE scope_key = ?
		  ORDER BY sent_at DESC, rowid DESC`,
		scopeKey,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/response_history: query list: %w", err)
	}
	defer rows.Close()

	out := []model.ResponseHistoryEntry{}
	for rows.Next() {
		e, err := scanResponseHistoryEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/response_history: scan list: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/response_history: rows: %w", err)
	}
	return out, nil
}

// Get decodes one row's snapshot_json and rebuilds Entry from the row's own summary columns
// (D4) — a corrupt snapshot_json is reported, not silently blanked, since Get is a single-entry
// lookup rather than a list a bad row could otherwise blank entirely (repos/saved_queries.go's
// posture is for List, not Get).
func (r *ResponseHistoryRepo) Get(id string) (model.ResponseHistorySnapshot, error) {
	row := r.DB.QueryRow(
		`SELECT `+responseHistoryEntryColumns+`, snapshot_json
		   FROM http_response_history WHERE id = ?`,
		id,
	)
	var (
		e            model.ResponseHistoryEntry
		itemID       sql.NullString
		snapshotJSON string
	)
	if err := row.Scan(
		&e.ID, &itemID, &e.TabID, &e.SentAt, &e.Method, &e.URL, &e.Environment,
		&e.Status, &e.StatusText, &e.ElapsedMs, &e.BodyBytes, &e.StoredBytes, &snapshotJSON,
	); err != nil {
		return model.ResponseHistorySnapshot{}, fmt.Errorf("repos/response_history: get: %w", err)
	}
	if itemID.Valid {
		e.ItemID = &itemID.String
	}

	var snap storedSnapshot
	if err := json.Unmarshal([]byte(snapshotJSON), &snap); err != nil {
		return model.ResponseHistorySnapshot{}, fmt.Errorf("repos/response_history: decode snapshot %s: %w", id, err)
	}

	return model.ResponseHistorySnapshot{
		Entry:                       e,
		Request:                     snap.Request,
		Response:                    snap.Response,
		BodyStored:                  snap.BodyStored,
		BodyStorageTruncated:        snap.BodyStorageTruncated,
		RequestBodyStorageTruncated: snap.RequestBodyStorageTruncated,
	}, nil
}

// Delete removes one entry.
func (r *ResponseHistoryRepo) Delete(id string) error {
	if _, err := r.DB.Exec(`DELETE FROM http_response_history WHERE id = ?`, id); err != nil {
		return fmt.Errorf("repos/response_history: delete: %w", err)
	}
	return nil
}

// Clear removes every entry in one scope.
func (r *ResponseHistoryRepo) Clear(scopeKey string) error {
	if _, err := r.DB.Exec(`DELETE FROM http_response_history WHERE scope_key = ?`, scopeKey); err != nil {
		return fmt.Errorf("repos/response_history: clear: %w", err)
	}
	return nil
}

// Adopt moves a scratch tab's history onto a newly-saved request (D14) — one UPDATE, scope
// follows via the generated column (F8) with no second write.
func (r *ResponseHistoryRepo) Adopt(tabID, itemID string) (int, error) {
	res, err := r.DB.Exec(
		`UPDATE http_response_history SET item_id = ? WHERE item_id IS NULL AND tab_id = ?`,
		itemID, tabID,
	)
	if err != nil {
		return 0, fmt.Errorf("repos/response_history: adopt: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("repos/response_history: adopt rows affected: %w", err)
	}
	return int(n), nil
}

// SweepOrphans deletes a scratch tab's history once its tab is gone (D7) — run once at launch
// (main.go, beside oplog's own startup prune, F18). tabs is the liveness oracle: TabsRepo.Save
// rewrites a window's whole tab set but always re-inserts what is currently open, so a row absent
// there is a tab that was actually closed.
func (r *ResponseHistoryRepo) SweepOrphans() error {
	if _, err := r.DB.Exec(
		`DELETE FROM http_response_history
		  WHERE item_id IS NULL AND tab_id NOT IN (SELECT id FROM tabs)`,
	); err != nil {
		return fmt.Errorf("repos/response_history: sweep orphans: %w", err)
	}
	return nil
}
