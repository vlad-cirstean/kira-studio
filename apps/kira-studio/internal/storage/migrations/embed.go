// Package migrations embeds the schema migration(s). The app has never shipped, so there is no
// installed base with a partially-applied schema to preserve — what were five incremental steps
// (0001_init through 0005_p28_tree_filters) are collapsed into the single 0001_init.sql that
// produces the exact same final schema in one shot (verified table-by-table via
// PRAGMA table_info/foreign_key_list/index_list against the old five-file sequence before they
// were deleted).
package migrations

import (
	"embed"
	"sort"
)

//go:embed *.sql
var files embed.FS

// Migration is one forward-only schema step.
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// names lists the embedded files in the exact order they must apply, rather than trusting
// directory listing order.
var names = []struct {
	version int
	name    string
	file    string
}{
	{1, "init", "0001_init.sql"},
	{2, "p8_windows", "0002_p8_windows.sql"},
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
