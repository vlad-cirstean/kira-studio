package appwire

import (
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
)

// opOwnersDir holds the owner lock files of processes that write op_log from outside the app.
func opOwnersDir() string { return filepath.Join(config.KiraSpaceHome(), "op-owners") }
