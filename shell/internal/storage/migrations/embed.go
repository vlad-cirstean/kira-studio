// Package migrations embeds the schema migrations byte-for-byte from
// src/main/storage/migrations/*.sql. They are plain SQLite DDL with no dialect issue, and keeping
// them identical to the TypeScript build means the Go schema is provably the same schema
// (P52 §4.3).
package migrations

import (
	"embed"
	"sort"
)

//go:embed *.sql
var files embed.FS

// Migration is one forward-only schema step, matching src/main/storage/migrations/index.ts's
// shape (version, name, sql).
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// names lists the embedded files in the exact order they must apply, mirroring
// src/main/storage/migrations/index.ts's own explicit ordering rather than trusting directory
// listing order.
var names = []struct {
	version int
	name    string
	file    string
}{
	{1, "init", "0001_init.sql"},
	{2, "p2", "0002_p2.sql"},
	{3, "p11", "0003_p11.sql"},
	{4, "misc_fixes", "0004_misc_fixes.sql"},
	{5, "p28_tree_filters", "0005_p28_tree_filters.sql"},
}

// All returns every migration in ascending version order.
func All() ([]Migration, error) {
	out := make([]Migration, 0, len(names))
	for _, n := range names {
		b, err := files.ReadFile(n.file)
		if err != nil {
			return nil, err
		}
		out = append(out, Migration{Version: n.version, Name: n.name, SQL: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}
