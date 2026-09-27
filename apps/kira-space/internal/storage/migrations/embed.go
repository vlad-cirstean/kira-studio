// Package migrations embeds Kira Space's own schema migrations — the app shipped no installed base
// before P100 Part 2, so 0001/0002 stayed one collapsed init pair the same shape Kira Studio's own
// migrations package used (see that package's own doc comment); every migration since (P128's own
// 0003) applies in the ordinary way against whatever schema is already on disk.
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
	{Version: 3, Name: "p128_window_mode", File: "0003_p128_window_mode.sql"},
	{Version: 4, Name: "p129_ade_sessions", File: "0004_p129_ade_sessions.sql"},
	{Version: 5, Name: "p129_ade_queue", File: "0005_p129_ade_queue.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
