// Package migrations embeds memory.db's schema steps.
package migrations

import (
	"embed"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

//go:embed *.sql
var files embed.FS

var names = []sqlitex.MigrationSource{
	{Version: 1, Name: "memories", File: "0001_memories.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
