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
	{Version: 2, Name: "embeddings", File: "0002_embeddings.sql"},
	{Version: 3, Name: "import", File: "0003_import.sql"},
	{Version: 4, Name: "provenance", File: "0004_p272_provenance.sql"},
	{Version: 5, Name: "ingest", File: "0005_p274_ingest.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
