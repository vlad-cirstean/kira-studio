package appwire

import (
	"fmt"
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/claudemodel"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// memoryModelFrom reads memory.claudeModel through the app's open settings handle.
func memoryModelFrom(r *repos.SettingsRepo) memory.ModelSource {
	return func() (string, error) {
		s, err := r.GetAll()
		if err != nil {
			return "", err
		}
		return s.Memory.ClaudeModel, nil
	}
}

// memoryModelAt serves the memory-mcp and memory-ingest processes: it opens kira.db per call, so a
// change in the app applies to the next call. A missing file means the default and is never created.
func memoryModelAt(dbPath string) memory.ModelSource {
	return func() (string, error) {
		if _, err := os.Stat(dbPath); err != nil {
			if os.IsNotExist(err) {
				return claudemodel.Default, nil
			}
			return "", err
		}
		db, err := sqlitex.Open(dbPath)
		if err != nil {
			return "", err
		}
		defer db.Close()
		s, err := (&repos.SettingsRepo{DB: db}).GetAll()
		if err != nil {
			return "", fmt.Errorf("read settings: %w", err)
		}
		return s.Memory.ClaudeModel, nil
	}
}
