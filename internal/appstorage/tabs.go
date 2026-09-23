package appstorage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// IsJSONObject reports whether raw is valid JSON whose top-level value is an object — both apps'
// own storage/model.TabRecord require their own `state` column to round-trip a Record<...>-shaped
// value, never a bare array or scalar.
func IsJSONObject(raw []byte) bool {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return false
	}
	_, ok := v.(map[string]any)
	return ok
}

// TabFields is the envelope both apps' own TabRecord types share — ValidateTab checks only this
// subset; each model keeps its own extra fields (Kira Studio's ConnectionID) and its own kind
// table around it.
type TabFields struct {
	ID          string
	Path        string
	Kind        string
	State       json.RawMessage
	WorkspaceID *string
}

// ValidateTab asserts the same envelope repos.TabsRepo.List already enforces on read (kind is
// renderable, state is a JSON object), plus the non-empty identity fields no SQL constraint
// covers. isRenderable is the caller's own RenderableTabKinds lookup; requireWorkspace reports
// whether that kind needs a non-empty WorkspaceID — Kira Studio requires it only for "terminal",
// Kira Space for every kind (P107 I2-30).
func ValidateTab(t TabFields, isRenderable, requireWorkspace func(kind string) bool) error {
	if t.ID == "" {
		return fmt.Errorf("model: tab: id is required")
	}
	if t.Path == "" {
		return fmt.Errorf("model: tab %q: path is required", t.ID)
	}
	if !isRenderable(t.Kind) {
		return fmt.Errorf("model: tab %q: unrecognised kind %q", t.ID, t.Kind)
	}
	if !IsJSONObject(t.State) {
		return fmt.Errorf("model: tab %q: state must be a JSON object", t.ID)
	}
	if requireWorkspace(t.Kind) && (t.WorkspaceID == nil || *t.WorkspaceID == "") {
		return fmt.Errorf("model: tab %q: workspaceId is required", t.ID)
	}
	return nil
}

// ReplaceKeyed runs the tx/upsert/prune-not-in-keys/commit frame both apps' own TabsRepo.Save
// shares (P107 I2-2): begin a transaction, hand it to upsert (which writes each record's own row,
// in whatever column shape the caller's table has), then delete every row scoped by keyColumn =
// scopeValue whose id is not in keys, then commit. keys empty means "delete every scoped row"
// (every tab closed) rather than relying on an empty `NOT IN ()`, which SQLite accepts but reads
// oddly for that case.
func ReplaceKeyed(db *sql.DB, table, keyColumn, scopeValue string, keys []string, upsert func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("appstorage: replace %s: begin: %w", table, err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := upsert(tx); err != nil {
		return err
	}

	if len(keys) == 0 {
		if _, err := tx.Exec(`DELETE FROM `+table+` WHERE `+keyColumn+` = ?`, scopeValue); err != nil {
			return fmt.Errorf("appstorage: replace %s: clear: %w", table, err)
		}
	} else {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")
		args := make([]any, 0, len(keys)+1)
		args = append(args, scopeValue)
		for _, id := range keys {
			args = append(args, id)
		}
		if _, err := tx.Exec(
			`DELETE FROM `+table+` WHERE `+keyColumn+` = ? AND id NOT IN (`+placeholders+`)`,
			args...,
		); err != nil {
			return fmt.Errorf("appstorage: replace %s: prune: %w", table, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("appstorage: replace %s: commit: %w", table, err)
	}
	return nil
}
