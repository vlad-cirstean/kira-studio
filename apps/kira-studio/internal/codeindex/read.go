package codeindex

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// scanSymbolRow scans one symbol row in SymbolRow's own column order — shared by every query below
// that reads the symbol table, so a column gets added in exactly one place.
func scanSymbolRow(scan func(dest ...any) error) (SymbolRow, error) {
	var sym SymbolRow
	var blockID, parentID sql.NullInt64
	err := scan(&sym.ID, &sym.FileID, &sym.RepoID, &blockID, &parentID, &sym.Kind, &sym.Name,
		&sym.StartByte, &sym.EndByte, &sym.StartRow, &sym.StartColumn, &sym.EndRow, &sym.EndColumn,
		&sym.NameStartByte, &sym.NameEndByte, &sym.NameStartRow, &sym.NameStartColumn)
	if err != nil {
		return SymbolRow{}, err
	}
	if blockID.Valid {
		v := blockID.Int64
		sym.BlockID = &v
	}
	if parentID.Valid {
		v := parentID.Int64
		sym.ParentID = &v
	}
	return sym, nil
}

const symbolColumns = `id, file_id, repo_id, block_id, parent_id, kind, name,
	       start_byte, end_byte, start_row, start_column, end_row, end_column,
	       name_start_byte, name_end_byte, name_start_row, name_start_column`

// scanReferenceRow is scanSymbolRow's own shape for the reference table (no parent_id, no end
// point — §2.4's schema).
func scanReferenceRow(scan func(dest ...any) error) (ReferenceRow, error) {
	var ref ReferenceRow
	var blockID sql.NullInt64
	err := scan(&ref.ID, &ref.FileID, &ref.RepoID, &blockID, &ref.Kind, &ref.Name,
		&ref.StartByte, &ref.EndByte, &ref.StartRow, &ref.StartColumn,
		&ref.NameStartByte, &ref.NameEndByte, &ref.NameStartRow, &ref.NameStartColumn)
	if err != nil {
		return ReferenceRow{}, err
	}
	if blockID.Valid {
		v := blockID.Int64
		ref.BlockID = &v
	}
	return ref, nil
}

const referenceColumns = `id, file_id, repo_id, block_id, kind, name,
	       start_byte, end_byte, start_row, start_column,
	       name_start_byte, name_end_byte, name_start_row, name_start_column`

// SymbolsInFile returns every symbol in fileID, ordered by start_byte — codegraph's own file-scoped
// reads (Outline, position lookup) load a file's symbols wholesale rather than one at a time,
// matching the reference-file reasoning C2 §3 states explicitly.
func (s *Store) SymbolsInFile(ctx context.Context, fileID int64) ([]SymbolRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+symbolColumns+`
		FROM symbol WHERE file_id = ? ORDER BY start_byte`, fileID)
	if err != nil {
		return nil, fmt.Errorf("codeindex: symbols in file: %w", err)
	}
	defer rows.Close()

	var out []SymbolRow
	for rows.Next() {
		sym, err := scanSymbolRow(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("codeindex: scan symbol row: %w", err)
		}
		out = append(out, sym)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: symbols in file: %w", err)
	}
	return out, nil
}

// ReferencesInFile returns every reference in fileID, ordered by start_byte.
func (s *Store) ReferencesInFile(ctx context.Context, fileID int64) ([]ReferenceRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+referenceColumns+`
		FROM reference WHERE file_id = ? ORDER BY start_byte`, fileID)
	if err != nil {
		return nil, fmt.Errorf("codeindex: references in file: %w", err)
	}
	defer rows.Close()

	var out []ReferenceRow
	for rows.Next() {
		ref, err := scanReferenceRow(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("codeindex: scan reference row: %w", err)
		}
		out = append(out, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: references in file: %w", err)
	}
	return out, nil
}

// ReferencesByName reads every reference named exactly name in repoID (`reference_name`'s own
// index) — the resolver's own candidate-gathering read (§5.1 step 1, run the other way: every
// reference to a name rather than every symbol).
func (s *Store) ReferencesByName(ctx context.Context, repoID, name string) ([]ReferenceRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+referenceColumns+`
		FROM reference WHERE repo_id = ? AND name = ?`, repoID, name)
	if err != nil {
		return nil, fmt.Errorf("codeindex: references by name: %w", err)
	}
	defer rows.Close()

	var out []ReferenceRow
	for rows.Next() {
		ref, err := scanReferenceRow(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("codeindex: scan reference row: %w", err)
		}
		out = append(out, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: references by name: %w", err)
	}
	return out, nil
}

// SymbolByID reads one symbol by its database id.
func (s *Store) SymbolByID(ctx context.Context, id int64) (SymbolRow, bool, error) {
	db, err := s.conn()
	if err != nil {
		return SymbolRow{}, false, err
	}
	row := db.QueryRowContext(ctx, `SELECT `+symbolColumns+` FROM symbol WHERE id = ?`, id)
	sym, err := scanSymbolRow(row.Scan)
	switch err {
	case nil:
		return sym, true, nil
	case sql.ErrNoRows:
		return SymbolRow{}, false, nil
	default:
		return SymbolRow{}, false, fmt.Errorf("codeindex: symbol by id: %w", err)
	}
}

// FileByID reads one file row by its database id.
func (s *Store) FileByID(ctx context.Context, id int64) (FileRow, bool, error) {
	db, err := s.conn()
	if err != nil {
		return FileRow{}, false, err
	}
	row := db.QueryRowContext(ctx, `
		SELECT id, repo_id, path, language, size_bytes, mtime_unix_ns, content_sha,
		       parse_status, has_error, line_count, parsed_at
		FROM file WHERE id = ?`, id)

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
		return FileRow{}, false, fmt.Errorf("codeindex: file by id: %w", err)
	}
}

// FilesByIDs batch-reads every file row named in ids — codegraph's own fan-in when a batch of
// symbol/reference rows names several distinct file_ids and one query beats one round trip per id.
// Order is not guaranteed to match ids; a caller that cares indexes the result by FileRow.ID.
func (s *Store) FilesByIDs(ctx context.Context, ids []int64) ([]FileRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	unique := dedupeInt64s(ids)
	placeholders := placeholdersFor(len(unique))
	args := make([]any, len(unique))
	for i, id := range unique {
		args[i] = id
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, repo_id, path, language, size_bytes, mtime_unix_ns, content_sha,
		       parse_status, has_error, line_count, parsed_at
		FROM file WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("codeindex: files by ids: %w", err)
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
		return nil, fmt.Errorf("codeindex: files by ids: %w", err)
	}
	return out, nil
}

func dedupeInt64s(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// SymbolHit is one SearchSymbols result: a SymbolRow plus its owning file's own path and language —
// what codegraph.SearchSymbols needs to build a Target without a second query per hit.
type SymbolHit struct {
	SymbolRow
	Path     string
	Language string
}

// SearchSymbols runs pattern — a caller-built SQL LIKE pattern (e.g. "name%" for a prefix search,
// "%name%" for a substring one), with any literal `%`/`_`/`\` in the user's own text already
// escaped by the caller and matched via `ESCAPE '\'` — against symbol_name's own (repo_id, name)
// index, optionally narrowed to kinds/languages, ordered by name then path for determinism, capped
// at limit. Ranking beyond that (exact match first, then prefix, then position, §4.3) is
// codegraph's own job over this result set, not SQL's.
func (s *Store) SearchSymbols(ctx context.Context, repoID, pattern string, kinds, languages []string, limit int) ([]SymbolHit, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	query := `SELECT sy.id, sy.file_id, sy.repo_id, sy.block_id, sy.parent_id, sy.kind, sy.name,
	                  sy.start_byte, sy.end_byte, sy.start_row, sy.start_column, sy.end_row, sy.end_column,
	                  sy.name_start_byte, sy.name_end_byte, sy.name_start_row, sy.name_start_column,
	                  f.path, f.language
	           FROM symbol sy JOIN file f ON f.id = sy.file_id
	           WHERE sy.repo_id = ? AND sy.name LIKE ? ESCAPE '\'`
	args := []any{repoID, pattern}
	if len(kinds) > 0 {
		query += ` AND sy.kind IN (` + placeholdersFor(len(kinds)) + `)`
		for _, k := range kinds {
			args = append(args, k)
		}
	}
	if len(languages) > 0 {
		query += ` AND f.language IN (` + placeholdersFor(len(languages)) + `)`
		for _, l := range languages {
			args = append(args, l)
		}
	}
	query += ` ORDER BY sy.name, f.path, sy.start_byte LIMIT ?`
	args = append(args, limit)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("codeindex: search symbols: %w", err)
	}
	defer rows.Close()

	var out []SymbolHit
	for rows.Next() {
		var hit SymbolHit
		var blockID, parentID sql.NullInt64
		if err := rows.Scan(&hit.ID, &hit.FileID, &hit.RepoID, &blockID, &parentID, &hit.Kind, &hit.Name,
			&hit.StartByte, &hit.EndByte, &hit.StartRow, &hit.StartColumn, &hit.EndRow, &hit.EndColumn,
			&hit.NameStartByte, &hit.NameEndByte, &hit.NameStartRow, &hit.NameStartColumn,
			&hit.Path, &hit.Language); err != nil {
			return nil, fmt.Errorf("codeindex: scan symbol hit: %w", err)
		}
		if blockID.Valid {
			v := blockID.Int64
			hit.BlockID = &v
		}
		if parentID.Valid {
			v := parentID.Int64
			hit.ParentID = &v
		}
		out = append(out, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: search symbols: %w", err)
	}
	return out, nil
}

// SearchFiles runs pattern (same LIKE-pattern convention as SearchSymbols) against file.path,
// ordered by path, capped at limit.
func (s *Store) SearchFiles(ctx context.Context, repoID, pattern string, limit int) ([]FileRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, repo_id, path, language, size_bytes, mtime_unix_ns, content_sha,
		       parse_status, has_error, line_count, parsed_at
		FROM file WHERE repo_id = ? AND path LIKE ? ESCAPE '\'
		ORDER BY path LIMIT ?`, repoID, pattern, limit)
	if err != nil {
		return nil, fmt.Errorf("codeindex: search files: %w", err)
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
		return nil, fmt.Errorf("codeindex: search files: %w", err)
	}
	return out, nil
}

// RepoInfo is one ListRepos result — enough for a second process (C3's MCP server, which has no
// gitclient.Runner) to map a worktree path to a repo_id (§4.1).
type RepoInfo struct {
	RepoID     string
	Root       string
	LastUsedAt int64
}

// ListRepos returns every repository this Store has meta.repo_root recorded for (Sync writes it,
// §4.1) — a repository indexed by a build predating this key has none and is omitted rather than
// reported with an empty root.
func (s *Store) ListRepos(ctx context.Context) ([]RepoInfo, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT repo_id, key, value FROM meta WHERE key IN ('repo_root', 'last_used_at')`)
	if err != nil {
		return nil, fmt.Errorf("codeindex: list repos: %w", err)
	}
	defer rows.Close()

	byRepo := map[string]*RepoInfo{}
	var order []string
	for rows.Next() {
		var repoID, key, value string
		if err := rows.Scan(&repoID, &key, &value); err != nil {
			return nil, fmt.Errorf("codeindex: scan meta row: %w", err)
		}
		info, ok := byRepo[repoID]
		if !ok {
			info = &RepoInfo{RepoID: repoID}
			byRepo[repoID] = info
			order = append(order, repoID)
		}
		switch key {
		case "repo_root":
			info.Root = value
		case "last_used_at":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				info.LastUsedAt = v
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("codeindex: list repos: %w", err)
	}

	out := make([]RepoInfo, 0, len(order))
	for _, repoID := range order {
		info := byRepo[repoID]
		if info.Root == "" {
			continue
		}
		out = append(out, *info)
	}
	return out, nil
}

func placeholdersFor(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}
