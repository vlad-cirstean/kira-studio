package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/id"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const savedQuerySelectColumns = `id, connection_id, path, name, kind, body, pinned, created_at, used_at`

type SavedQueriesRepo struct {
	DB *sql.DB
}

// scanSavedQueryRow scans one row and validates it the same way saved-queries.ts's
// parseSavedQueryRow does: an unparseable body, or one that doesn't match its own kind's shape,
// drops the row (nil, nil) rather than propagating it.
func scanSavedQueryRow(row rowScanner) (*model.SavedQuery, error) {
	var (
		q      model.SavedQuery
		pinned int
		usedAt sql.NullString
		body   string
	)
	if err := row.Scan(&q.ID, &q.ConnectionID, &q.Path, &q.Name, &q.Kind, &body, &pinned, &q.CreatedAt, &usedAt); err != nil {
		return nil, err
	}
	q.Pinned = pinned != 0
	if usedAt.Valid {
		q.UsedAt = &usedAt.String
	}

	if !json.Valid([]byte(body)) {
		slog.Warn("dropping saved query: body is not valid JSON", "scope", "storage/saved-queries", "id", q.ID)
		return nil, nil
	}
	switch q.Kind {
	case "filter":
		var fb model.FilterBody
		// DisallowUnknownFields is what actually distinguishes a filter body from a console
		// body: FilterBody/ConsoleBody's fields don't overlap, and json.Unmarshal alone
		// silently ignores a console body's "text" key when decoding into FilterBody instead
		// of rejecting it.
		dec := json.NewDecoder(strings.NewReader(body))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&fb); err != nil {
			slog.Warn("dropping saved query: body does not match filter shape", "scope", "storage/saved-queries", "id", q.ID)
			return nil, nil
		}
	case "console":
		var cb model.ConsoleBody
		dec := json.NewDecoder(strings.NewReader(body))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&cb); err != nil {
			slog.Warn("dropping saved query: body does not match console shape", "scope", "storage/saved-queries", "id", q.ID)
			return nil, nil
		}
	default:
		slog.Warn("dropping saved query: unrecognised kind", "scope", "storage/saved-queries", "id", q.ID, "kind", q.Kind)
		return nil, nil
	}
	q.Body = json.RawMessage(body)
	return &q, nil
}

func (r *SavedQueriesRepo) listByKind(connectionID, path, kind string) ([]model.SavedQuery, error) {
	rows, err := r.DB.Query(
		`SELECT `+savedQuerySelectColumns+`
		   FROM saved_queries
		  WHERE connection_id = ? AND path = ? AND kind = ?
		  ORDER BY pinned DESC, used_at DESC, name`,
		connectionID, path, kind,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/saved_queries: query: %w", err)
	}
	defer rows.Close()

	out := []model.SavedQuery{}
	for rows.Next() {
		q, err := scanSavedQueryRow(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/saved_queries: scan: %w", err)
		}
		if q != nil {
			out = append(out, *q)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/saved_queries: rows: %w", err)
	}
	return out, nil
}

func (r *SavedQueriesRepo) ListFilters(connectionID, path string) ([]model.SavedQuery, error) {
	return r.listByKind(connectionID, path, "filter")
}

func (r *SavedQueriesRepo) ListConsole(connectionID, path string) ([]model.SavedQuery, error) {
	return r.listByKind(connectionID, path, "console")
}

func (r *SavedQueriesRepo) insert(connectionID, path, name, kind string, body []byte) (model.SavedQuery, error) {
	if err := model.ValidSavedQueryName(name); err != nil {
		return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: %w", err)
	}
	newID := id.New()
	now := model.NowISO()
	if _, err := r.DB.Exec(
		`INSERT INTO saved_queries (id, connection_id, path, name, kind, body, pinned, created_at, used_at)
		 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		newID, connectionID, path, name, kind, string(body), now, now,
	); err != nil {
		return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: insert: %w", err)
	}
	return r.mustGet(newID)
}

func (r *SavedQueriesRepo) mustGet(queryID string) (model.SavedQuery, error) {
	row := r.DB.QueryRow(`SELECT `+savedQuerySelectColumns+` FROM saved_queries WHERE id = ?`, queryID)
	q, err := scanSavedQueryRow(row)
	if err != nil {
		return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: get %s: %w", queryID, err)
	}
	if q == nil {
		return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: row %s not found or failed to parse", queryID)
	}
	return *q, nil
}

func (r *SavedQueriesRepo) SaveFilter(connectionID, path, name string, body model.FilterBody, pinned bool) (model.SavedQuery, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: encode filter body: %w", err)
	}
	q, err := r.insert(connectionID, path, name, "filter", encoded)
	if err != nil {
		return model.SavedQuery{}, err
	}
	if pinned {
		if err := r.setPinned(q.ID, true); err != nil {
			return model.SavedQuery{}, err
		}
		return r.mustGet(q.ID)
	}
	return q, nil
}

func (r *SavedQueriesRepo) SaveConsole(connectionID, path, name string, body model.ConsoleBody, pinned bool) (model.SavedQuery, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: encode console body: %w", err)
	}
	q, err := r.insert(connectionID, path, name, "console", encoded)
	if err != nil {
		return model.SavedQuery{}, err
	}
	if pinned {
		if err := r.setPinned(q.ID, true); err != nil {
			return model.SavedQuery{}, err
		}
		return r.mustGet(q.ID)
	}
	return q, nil
}

func (r *SavedQueriesRepo) setPinned(queryID string, pinned bool) error {
	if _, err := r.DB.Exec(`UPDATE saved_queries SET pinned = ? WHERE id = ?`, boolToInt(pinned), queryID); err != nil {
		return fmt.Errorf("repos/saved_queries: set pinned %s: %w", queryID, err)
	}
	return nil
}

// Update is kind-agnostic (queries.ts's own updateSavedQuery): id alone identifies the row, and
// neither field touches body/kind.
func (r *SavedQueriesRepo) Update(queryID string, patch model.SavedQueryPatch) (model.SavedQuery, error) {
	if patch.Name != nil {
		if err := model.ValidSavedQueryName(*patch.Name); err != nil {
			return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: %w", err)
		}
		if _, err := r.DB.Exec(`UPDATE saved_queries SET name = ? WHERE id = ?`, *patch.Name, queryID); err != nil {
			return model.SavedQuery{}, fmt.Errorf("repos/saved_queries: update name %s: %w", queryID, err)
		}
	}
	if patch.Pinned != nil {
		if err := r.setPinned(queryID, *patch.Pinned); err != nil {
			return model.SavedQuery{}, err
		}
	}
	return r.mustGet(queryID)
}

func (r *SavedQueriesRepo) Delete(queryID string) error {
	if _, err := r.DB.Exec(`DELETE FROM saved_queries WHERE id = ?`, queryID); err != nil {
		return fmt.Errorf("repos/saved_queries: delete %s: %w", queryID, err)
	}
	return nil
}

func (r *SavedQueriesRepo) Touch(queryID string) error {
	if _, err := r.DB.Exec(`UPDATE saved_queries SET used_at = ? WHERE id = ?`, model.NowISO(), queryID); err != nil {
		return fmt.Errorf("repos/saved_queries: touch %s: %w", queryID, err)
	}
	return nil
}
