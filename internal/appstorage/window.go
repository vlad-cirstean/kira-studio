package appstorage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// WindowBounds is a plain screen rectangle, shared by every window's stored geometry — field-for-
// field identical to each app's own storage/model.WindowBounds (and to internal/shell's own
// WindowBounds, which exists for the same reason: this package stays independent of any per-app
// storage package, so a caller converts at its own boundary, same idiom internal/shell/deps.go's
// own WindowBounds doc comment already established).
type WindowBounds struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// ValidateWindowBounds is the non-empty-identity envelope every app's own WindowRecord.Validate
// enforces before a write — key non-empty, order >= 0 — regardless of whatever extra fields that
// app's own record carries (Studio's own Mode; Space has none).
func ValidateWindowBounds(key string, order int) error {
	if key == "" {
		return errors.New("model: window: key is required")
	}
	if order < 0 {
		return fmt.Errorf("model: window %q: order must be >= 0", key)
	}
	return nil
}

// WindowRepo reads and writes the `windows` table's identity/geometry columns. Each app's own
// WindowsRepo embeds one of these (constructed against its own DB) for Exists/Create/
// EnsureExists/SetBounds, and keeps its own List/Delete (and Studio's own GetMode/SetMode) on top
// — those touch the `mode` column and app-specific model types this package deliberately stays
// clear of.
type WindowRepo struct {
	DB *sql.DB
}

// Exists reports whether key names a live `windows` row.
func (r *WindowRepo) Exists(key string) (bool, error) {
	var one int
	err := r.DB.QueryRow(`SELECT 1 FROM windows WHERE key = ?`, key).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("appstorage/windows: exists %s: %w", key, err)
	}
	return true, nil
}

// Create inserts a new window record. The caller mints key (D2: a UUID the shell owns); bounds may
// be nil (a freshly minted window with no stored rectangle yet).
func (r *WindowRepo) Create(key string, order int, bounds *WindowBounds) error {
	if err := ValidateWindowBounds(key, order); err != nil {
		return fmt.Errorf("appstorage/windows: %w", err)
	}
	var boundsJSON any
	if bounds != nil {
		encoded, err := json.Marshal(bounds)
		if err != nil {
			return fmt.Errorf("appstorage/windows: encode bounds: %w", err)
		}
		boundsJSON = string(encoded)
	}
	if _, err := r.DB.Exec(
		`INSERT INTO windows (key, "order", bounds_json) VALUES (?, ?, ?)`,
		key, order, boundsJSON,
	); err != nil {
		return fmt.Errorf("appstorage/windows: insert %s: %w", key, err)
	}
	return nil
}

// EnsureExists creates a `windows` row for key if one doesn't already exist, ordered after every
// row already present, with no stored bounds — idempotent, and a no-op when the row is already
// there. Runs inside one transaction so two concurrent Ensure calls for the same brand-new key
// can't both observe "absent" and then race each other's INSERT.
func (r *WindowRepo) EnsureExists(key string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("appstorage/windows: ensure begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM windows WHERE key = ?)`, key).Scan(&exists); err != nil {
		return fmt.Errorf("appstorage/windows: ensure exists %s: %w", key, err)
	}
	if !exists {
		var maxOrder sql.NullInt64
		if err := tx.QueryRow(`SELECT MAX("order") FROM windows`).Scan(&maxOrder); err != nil {
			return fmt.Errorf("appstorage/windows: ensure max order: %w", err)
		}
		order := 0
		if maxOrder.Valid {
			order = int(maxOrder.Int64) + 1
		}
		if _, err := tx.Exec(
			`INSERT INTO windows (key, "order", bounds_json) VALUES (?, ?, NULL)`, key, order,
		); err != nil {
			return fmt.Errorf("appstorage/windows: ensure insert %s: %w", key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("appstorage/windows: ensure commit: %w", err)
	}
	return nil
}

// SetBounds persists one window's rectangle.
func (r *WindowRepo) SetBounds(key string, b WindowBounds) error {
	encoded, err := json.Marshal(b)
	if err != nil {
		return fmt.Errorf("appstorage/windows: encode bounds: %w", err)
	}
	res, err := r.DB.Exec(`UPDATE windows SET bounds_json = ? WHERE key = ?`, string(encoded), key)
	if err != nil {
		return fmt.Errorf("appstorage/windows: update %s: %w", key, err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("appstorage/windows: %s: no such window", key)
	}
	return nil
}
