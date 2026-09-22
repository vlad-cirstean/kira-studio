// Package migrations embeds Kira Space's own schema migration(s) — the app has never shipped, so
// there is no installed base with a partially-applied schema to preserve, the same "one collapsed
// init migration" shape Kira Studio's own migrations package used (see that package's own doc
// comment).
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
	{2, "p100_tabs_layout", "0002_p100_tabs_layout.sql"},
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
