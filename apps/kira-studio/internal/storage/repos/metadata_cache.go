package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// maxMetadataPayloadBytes and maxMetadataRowsPerConnection mirror metadata-cache.ts's
// MAX_PAYLOAD_BYTES and MAX_ROWS_PER_CONNECTION (P43 iter2 F15/D20).
const (
	maxMetadataPayloadBytes      = 4 * 1024 * 1024
	maxMetadataRowsPerConnection = 200
)

type MetadataCacheRepo struct {
	DB *sql.DB
}

// readPayload returns the row's payload object (or nil if there is no row / it fails to parse —
// treated as a miss, mirroring metadata-cache.ts's own try/catch).
func readPayload(q interface {
	QueryRow(query string, args ...any) *sql.Row
}, connectionID, path string) map[string]json.RawMessage {
	var payloadJSON string
	err := q.QueryRow(
		`SELECT payload_json FROM metadata_cache WHERE connection_id = ? AND path = ?`,
		connectionID, path,
	).Scan(&payloadJSON)
	if err != nil {
		return nil
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return nil
	}
	return payload
}

// Get is JSON.parse'd, NOT further validated here — callers parse through their own domain
// shape and treat a mismatch as a miss (metadata-cache.ts's own discipline).
func (r *MetadataCacheRepo) Get(connectionID, path, kind string) (json.RawMessage, error) {
	payload := readPayload(r.DB, connectionID, path)
	return payload[kind], nil
}

// Put merges payload into the existing row's {children?, describe?, definition?} object (the
// unique index is (connection_id, path) — kind is not part of the key, so a 'children' payload
// and a 'describe' payload for the same path share one row), then runs D20's per-connection
// eviction — all in one transaction.
func (r *MetadataCacheRepo) Put(connectionID, path, kind string, payload json.RawMessage) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/metadata_cache: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	existing := readPayload(tx, connectionID, path)
	merged := map[string]json.RawMessage{}
	for k, v := range existing {
		merged[k] = v
	}
	merged[kind] = payload

	encoded, err := json.Marshal(merged)
	if err != nil {
		return fmt.Errorf("repos/metadata_cache: encode merged payload: %w", err)
	}
	if len(encoded) > maxMetadataPayloadBytes {
		slog.Warn("payload exceeds 4 MB, not cached", "scope", "storage/metadata-cache", "connectionId", connectionID, "path", path)
		return nil // not an error; the deferred Rollback is a no-op since nothing was written.
	}

	if _, err := tx.Exec(
		`INSERT INTO metadata_cache (connection_id, path, kind, payload_json, fetched_at, etag)
		 VALUES (?, ?, ?, ?, ?, NULL)
		 ON CONFLICT(connection_id, path) DO UPDATE SET kind = excluded.kind, payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
		connectionID, path, kind, string(encoded), model.NowISO(),
	); err != nil {
		return fmt.Errorf("repos/metadata_cache: upsert: %w", err)
	}

	if _, err := tx.Exec(`
		DELETE FROM metadata_cache
		 WHERE connection_id = ?
		   AND path NOT IN (
		     SELECT path FROM metadata_cache
		      WHERE connection_id = ?
		      ORDER BY fetched_at DESC, rowid DESC
		      LIMIT ?
		   )
	`, connectionID, connectionID, maxMetadataRowsPerConnection); err != nil {
		return fmt.Errorf("repos/metadata_cache: evict: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/metadata_cache: commit: %w", err)
	}
	return nil
}

// Drop clears one cached path (path == "" clears the whole connection — see DropConnection for
// the explicit form callers should prefer for that case).
func (r *MetadataCacheRepo) Drop(connectionID, path string) error {
	if _, err := r.DB.Exec(
		`DELETE FROM metadata_cache WHERE connection_id = ? AND path = ?`, connectionID, path,
	); err != nil {
		return fmt.Errorf("repos/metadata_cache: drop %s:%s: %w", connectionID, path, err)
	}
	return nil
}

// DropConnection drops every cached row for the whole connection (metadata-cache.ts's
// dropCached with path omitted).
func (r *MetadataCacheRepo) DropConnection(connectionID string) error {
	if _, err := r.DB.Exec(`DELETE FROM metadata_cache WHERE connection_id = ?`, connectionID); err != nil {
		return fmt.Errorf("repos/metadata_cache: drop connection %s: %w", connectionID, err)
	}
	return nil
}
