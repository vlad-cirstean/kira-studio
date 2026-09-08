// Package migrations embeds review.db's own schema steps — a sibling of internal/storage/
// migrations, deliberately duplicated rather than shared (gitreview/migrate.go's own doc comment
// explains why): a second SQLite file with its own lifecycle, not a table in kira.db.
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
// directory listing order — G13 took this slot (the "G12 adds a comment table" reservation this
// comment used to name predates the chapter's mid-stream phase insertions: G12 shipped no
// migration at all). A further step is the next phase's to reserve.
var names = []struct {
	version int
	name    string
	file    string
}{
	{1, "g11_review", "0001_g11_review.sql"},
	{2, "g13_comments", "0002_g13_comments.sql"},
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
