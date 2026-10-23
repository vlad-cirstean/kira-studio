package repos

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// FileHandlerPreviousRepo reads and writes `file_handler_previous`.
type FileHandlerPreviousRepo struct {
	DB *sql.DB
}

// Get returns the saved handler of ext; ok is false when none is saved.
func (r *FileHandlerPreviousRepo) Get(ext string) (appPath string, ok bool, err error) {
	err = r.DB.QueryRow(`SELECT app_path FROM file_handler_previous WHERE ext = ?`, ext).Scan(&appPath)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("repos: get file handler %s: %w", ext, err)
	}
	return appPath, true, nil
}

// Put stores the handler, replacing any row for the same extension.
func (r *FileHandlerPreviousRepo) Put(ext, appPath, bundleID string) error {
	_, err := r.DB.Exec(
		`INSERT INTO file_handler_previous (ext, app_path, bundle_id, saved_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(ext) DO UPDATE SET app_path = excluded.app_path, bundle_id = excluded.bundle_id, saved_at = excluded.saved_at`,
		ext, appPath, bundleID, time.Now().UnixMilli())
	if err != nil {
		return fmt.Errorf("repos: put file handler %s: %w", ext, err)
	}
	return nil
}

// Delete drops the row of ext; a missing row is not an error.
func (r *FileHandlerPreviousRepo) Delete(ext string) error {
	if _, err := r.DB.Exec(`DELETE FROM file_handler_previous WHERE ext = ?`, ext); err != nil {
		return fmt.Errorf("repos: delete file handler %s: %w", ext, err)
	}
	return nil
}
