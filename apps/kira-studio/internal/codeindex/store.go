package codeindex

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

// ParseStatus is §5.2's closed set for file.parse_status.
type ParseStatus string

const (
	StatusOK         ParseStatus = "ok"
	StatusTooLarge   ParseStatus = "tooLarge"
	StatusBinary     ParseStatus = "binary"
	StatusUnreadable ParseStatus = "unreadable"
)

// FileRow is one file table row, as read back — the staleness comparands (§5.3) plus everything
// else a caller needs without a second query.
type FileRow struct {
	ID          int64
	RepoID      string
	Path        string
	Language    string
	SizeBytes   int64
	MtimeUnixNs int64
	ContentSHA  []byte
	ParseStatus ParseStatus
	HasError    bool
	LineCount   int
	ParsedAt    int64
}

// SymbolRow is one symbol table row, as read back.
type SymbolRow struct {
	ID                            int64
	FileID                        int64
	RepoID                        string
	BlockID                       *int64
	ParentID                      *int64
	Kind                          string
	Name                          string
	StartByte, EndByte            int
	StartRow, StartColumn         int
	EndRow, EndColumn             int
	NameStartByte, NameEndByte    int
	NameStartRow, NameStartColumn int
}

// ReferenceRow is one reference table row, as read back — SymbolRow's own shape, less ParentID
// (a reference has no containment parent of its own) and EndRow/EndColumn (§2.4: only the
// reference node's start point is stored, same as before C2; NameStartByte/NameEndByte/
// NameStartRow/NameStartColumn are new, the identifier's own range).
type ReferenceRow struct {
	ID                            int64
	FileID                        int64
	RepoID                        string
	BlockID                       *int64
	Kind                          string
	Name                          string
	StartByte, EndByte            int
	StartRow, StartColumn         int
	NameStartByte, NameEndByte    int
	NameStartRow, NameStartColumn int
}

// FileWrite bundles one file's whole parse result — everything ReplaceFile needs to write it in
// one transaction (§6: "a file's rows are replaced wholesale... delete this file's symbols,
// blocks and references, insert the new ones").
type FileWrite struct {
	RepoID      string
	Path        string // repository-relative, git's own bytes (tier 2: never NFC-normalized)
	Language    string
	SizeBytes   int64
	MtimeUnixNs int64
	ContentSHA  []byte // sha256, 32 bytes
	ParseStatus ParseStatus
	HasError    bool
	LineCount   int
	ParsedAt    int64 // unix millis

	Blocks     []codeparse.Block
	Symbols    []codeparse.Symbol
	References []codeparse.Reference
}

func boolToInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// replaceFileBatch is §6's own transaction size: "writes batch into transactions of 256 files."
const replaceFileBatch = 256

// ReplaceFile is ReplaceFiles for a single file — a test or a one-off caller's convenience.
func (s *Store) ReplaceFile(ctx context.Context, w FileWrite) error {
	return s.ReplaceFiles(ctx, []FileWrite{w})
}

// ReplaceFiles writes every w in ws, chunked into transactions of at most replaceFileBatch files
// (§6) — each file's own rows are still replaced wholesale within its own chunk's transaction
// (delete this file's symbols/blocks/references, insert the new ones): a partial per-symbol
// update would buy nothing and would need its own invalidation rules.
func (s *Store) ReplaceFiles(ctx context.Context, ws []FileWrite) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	for start := 0; start < len(ws); start += replaceFileBatch {
		end := start + replaceFileBatch
		if end > len(ws) {
			end = len(ws)
		}
		if err := replaceFilesTx(ctx, db, ws[start:end]); err != nil {
			return err
		}
	}
	return nil
}

// replaceFilesTx writes one batch inside a single transaction.
//
// Each file's symbols insert in two passes: the first assigns every row its real database id
// (parent_id left NULL), the second fixes parent_id now that codeparse.Symbol.ParentIndex (an
// index into that file's own Symbols slice, -1 for none) can be translated into a real id.
// block_id needs no such fixup — it is resolved directly from the block-id slice built while
// inserting that file's own Blocks, in the same order.
func replaceFilesTx(ctx context.Context, db *sql.DB, ws []FileWrite) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("codeindex: begin replace files: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op once Commit has succeeded.

	for _, w := range ws {
		if err := replaceOneFileTx(ctx, tx, w); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("codeindex: commit replace files: %w", err)
	}
	return nil
}

func replaceOneFileTx(ctx context.Context, tx *sql.Tx, w FileWrite) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM file WHERE repo_id = ? AND path = ?`, w.RepoID, w.Path); err != nil {
		return fmt.Errorf("codeindex: delete existing file %s: %w", w.Path, err)
	}

	res, err := tx.ExecContext(ctx, `
		INSERT INTO file (repo_id, path, language, size_bytes, mtime_unix_ns, content_sha,
		                   parse_status, has_error, line_count, parsed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.RepoID, w.Path, w.Language, w.SizeBytes, w.MtimeUnixNs, w.ContentSHA,
		string(w.ParseStatus), boolToInt(w.HasError), w.LineCount, w.ParsedAt)
	if err != nil {
		return fmt.Errorf("codeindex: insert file %s: %w", w.Path, err)
	}
	fileID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("codeindex: file %s last insert id: %w", w.Path, err)
	}

	blockIDs := make([]int64, len(w.Blocks))
	for i, b := range w.Blocks {
		r, err := tx.ExecContext(ctx, `
			INSERT INTO file_block (file_id, kind, language, start_byte, end_byte, start_row, start_column)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			fileID, string(b.Kind), string(b.Language), b.StartByte, b.EndByte,
			b.StartPoint.Row, b.StartPoint.Column)
		if err != nil {
			return fmt.Errorf("codeindex: insert file_block %s[%d]: %w", w.Path, i, err)
		}
		id, err := r.LastInsertId()
		if err != nil {
			return fmt.Errorf("codeindex: file_block %s[%d] last insert id: %w", w.Path, i, err)
		}
		blockIDs[i] = id
	}

	symbolIDs := make([]int64, len(w.Symbols))
	for i, sym := range w.Symbols {
		var blockID any
		if sym.BlockIndex >= 0 {
			blockID = blockIDs[sym.BlockIndex]
		}
		r, err := tx.ExecContext(ctx, `
			INSERT INTO symbol (file_id, repo_id, block_id, parent_id, kind, name,
			                     start_byte, end_byte, start_row, start_column, end_row, end_column,
			                     name_start_byte, name_end_byte, name_start_row, name_start_column)
			VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			fileID, w.RepoID, blockID, sym.Kind, sym.Name,
			sym.StartByte, sym.EndByte, sym.StartPoint.Row, sym.StartPoint.Column,
			sym.EndPoint.Row, sym.EndPoint.Column,
			sym.NameStartByte, sym.NameEndByte, sym.NameStart.Row, sym.NameStart.Column)
		if err != nil {
			return fmt.Errorf("codeindex: insert symbol %s[%d]: %w", w.Path, i, err)
		}
		id, err := r.LastInsertId()
		if err != nil {
			return fmt.Errorf("codeindex: symbol %s[%d] last insert id: %w", w.Path, i, err)
		}
		symbolIDs[i] = id
	}
	for i, sym := range w.Symbols {
		if sym.ParentIndex < 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE symbol SET parent_id = ? WHERE id = ?`,
			symbolIDs[sym.ParentIndex], symbolIDs[i]); err != nil {
			return fmt.Errorf("codeindex: link symbol %s[%d] parent: %w", w.Path, i, err)
		}
	}

	for i, ref := range w.References {
		var blockID any
		if ref.BlockIndex >= 0 {
			blockID = blockIDs[ref.BlockIndex]
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO reference (file_id, repo_id, block_id, kind, name, start_byte, end_byte, start_row, start_column,
			                         name_start_byte, name_end_byte, name_start_row, name_start_column)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			fileID, w.RepoID, blockID, ref.Kind, ref.Name,
			ref.StartByte, ref.EndByte, ref.StartPoint.Row, ref.StartPoint.Column,
			ref.NameStartByte, ref.NameEndByte, ref.NameStart.Row, ref.NameStart.Column); err != nil {
			return fmt.Errorf("codeindex: insert reference %s[%d]: %w", w.Path, i, err)
		}
	}
	return nil
}

// DeleteFile removes repoID/path's row (cascading to its blocks/symbols/references) — reconcile's
// own call for a path that left enumeration (§6 step 3).
func (s *Store) DeleteFile(ctx context.Context, repoID, path string) error {
	return s.DeleteFiles(ctx, repoID, []string{path})
}

// DeleteFiles removes every one of repoID/paths' rows in a single transaction — reconcile's own
// batch call for every path that left enumeration in one Sync pass (§6 step 3).
func (s *Store) DeleteFiles(ctx context.Context, repoID string, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("codeindex: begin delete files: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, path := range paths {
		if _, err := tx.ExecContext(ctx, `DELETE FROM file WHERE repo_id = ? AND path = ?`, repoID, path); err != nil {
			return fmt.Errorf("codeindex: delete file %s: %w", path, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("codeindex: commit delete files: %w", err)
	}
	return nil
}

// DeleteRepo removes every row belonging to repoID (§5.4's idle-repository sweep, and useful for
// tests): cascading from file down through file_block/symbol/reference, plus its own meta rows.
func (s *Store) DeleteRepo(ctx context.Context, repoID string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("codeindex: begin delete repo: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM file WHERE repo_id = ?`, repoID); err != nil {
		return fmt.Errorf("codeindex: delete repo files: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM meta WHERE repo_id = ?`, repoID); err != nil {
		return fmt.Errorf("codeindex: delete repo meta: %w", err)
	}
	return tx.Commit()
}

// ListFiles returns every file row for repoID — sync.go's own staleness pass compares each against
// disk (§5.3) and reconcile's own deletion pass (§6 step 3) diffs this list against enumeration.
func (s *Store) ListFiles(ctx context.Context, repoID string) ([]FileRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, repo_id, path, language, size_bytes, mtime_unix_ns, content_sha,
		       parse_status, has_error, line_count, parsed_at
		FROM file WHERE repo_id = ?`, repoID)
	if err != nil {
		return nil, fmt.Errorf("codeindex: list files: %w", err)
	}
	defer rows.Close()

	var out []FileRow
	for rows.Next() {
		var f FileRow
		var hasError int64
		var status string
		if err := rows.Scan(&f.ID, &f.RepoID, &f.Path, &f.Language, &f.SizeBytes, &f.MtimeUnixNs,
			&f.ContentSHA, &status, &hasError, &f.LineCount, &f.ParsedAt); err != nil {
			return nil, fmt.Errorf("codeindex: scan file row: %w", err)
		}
		f.ParseStatus = ParseStatus(status)
		f.HasError = hasError != 0
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: list files: %w", err)
	}
	return out, nil
}

// GetFile reads one file row by its repository-relative path.
func (s *Store) GetFile(ctx context.Context, repoID, path string) (FileRow, bool, error) {
	db, err := s.conn()
	if err != nil {
		return FileRow{}, false, err
	}
	row := db.QueryRowContext(ctx, `
		SELECT id, repo_id, path, language, size_bytes, mtime_unix_ns, content_sha,
		       parse_status, has_error, line_count, parsed_at
		FROM file WHERE repo_id = ? AND path = ?`, repoID, path)

	var f FileRow
	var hasError int64
	var status string
	switch err := row.Scan(&f.ID, &f.RepoID, &f.Path, &f.Language, &f.SizeBytes, &f.MtimeUnixNs,
		&f.ContentSHA, &status, &hasError, &f.LineCount, &f.ParsedAt); err {
	case nil:
		f.ParseStatus = ParseStatus(status)
		f.HasError = hasError != 0
		return f, true, nil
	case sql.ErrNoRows:
		return FileRow{}, false, nil
	default:
		return FileRow{}, false, fmt.Errorf("codeindex: get file: %w", err)
	}
}

// FindSymbolsByName reads every symbol named exactly name in repoID (`symbol_name`'s own index).
func (s *Store) FindSymbolsByName(ctx context.Context, repoID, name string) ([]SymbolRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, file_id, repo_id, block_id, parent_id, kind, name,
		       start_byte, end_byte, start_row, start_column, end_row, end_column,
		       name_start_byte, name_end_byte, name_start_row, name_start_column
		FROM symbol WHERE repo_id = ? AND name = ?`, repoID, name)
	if err != nil {
		return nil, fmt.Errorf("codeindex: find symbols by name: %w", err)
	}
	defer rows.Close()

	var out []SymbolRow
	for rows.Next() {
		var sym SymbolRow
		var blockID, parentID sql.NullInt64
		if err := rows.Scan(&sym.ID, &sym.FileID, &sym.RepoID, &blockID, &parentID, &sym.Kind, &sym.Name,
			&sym.StartByte, &sym.EndByte, &sym.StartRow, &sym.StartColumn, &sym.EndRow, &sym.EndColumn,
			&sym.NameStartByte, &sym.NameEndByte, &sym.NameStartRow, &sym.NameStartColumn); err != nil {
			return nil, fmt.Errorf("codeindex: scan symbol row: %w", err)
		}
		if blockID.Valid {
			v := blockID.Int64
			sym.BlockID = &v
		}
		if parentID.Valid {
			v := parentID.Int64
			sym.ParentID = &v
		}
		out = append(out, sym)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: find symbols by name: %w", err)
	}
	return out, nil
}

// GetMeta reads one (repoID, key) meta value.
func (s *Store) GetMeta(ctx context.Context, repoID, key string) (string, bool, error) {
	db, err := s.conn()
	if err != nil {
		return "", false, err
	}
	var value string
	switch err := db.QueryRowContext(ctx, `SELECT value FROM meta WHERE repo_id = ? AND key = ?`, repoID, key).Scan(&value); err {
	case nil:
		return value, true, nil
	case sql.ErrNoRows:
		return "", false, nil
	default:
		return "", false, fmt.Errorf("codeindex: get meta: %w", err)
	}
}

// SetMeta writes one (repoID, key) meta value, replacing any existing one.
func (s *Store) SetMeta(ctx context.Context, repoID, key, value string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO meta (repo_id, key, value) VALUES (?, ?, ?)
		ON CONFLICT (repo_id, key) DO UPDATE SET value = excluded.value`,
		repoID, key, value); err != nil {
		return fmt.Errorf("codeindex: set meta: %w", err)
	}
	return nil
}
