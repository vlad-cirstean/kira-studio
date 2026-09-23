// Package migrations embeds Kira Space's own schema migration(s) — the app has never shipped, so
// there is no installed base with a partially-applied schema to preserve, the same "one collapsed
// init migration" shape Kira Studio's own migrations package used (see that package's own doc
// comment).
package migrations

import (
	"embed"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

//go:embed *.sql
var files embed.FS

// names lists the embedded files in the exact order they must apply, rather than trusting
// directory listing order.
var names = []sqlitex.MigrationSource{
	{Version: 1, Name: "init", File: "0001_init.sql"},
	{Version: 2, Name: "p100_tabs_layout", File: "0002_p100_tabs_layout.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
