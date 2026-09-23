// Package migrations embeds review.db's own schema steps — a sibling of internal/storage/
// migrations, deliberately duplicated rather than shared (gitreview/migrate.go's own doc comment
// explains why): a second SQLite file with its own lifecycle, not a table in kira.db.
package migrations

import (
	"embed"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

//go:embed *.sql
var files embed.FS

// names lists the embedded files in the exact order they must apply, rather than trusting
// directory listing order — G13 took this slot (the "G12 adds a comment table" reservation this
// comment used to name predates the chapter's mid-stream phase insertions: G12 shipped no
// migration at all). A further step is the next phase's to reserve.
var names = []sqlitex.MigrationSource{
	{Version: 1, Name: "g11_review", File: "0001_g11_review.sql"},
	{Version: 2, Name: "g13_comments", File: "0002_g13_comments.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
