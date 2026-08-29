package logging

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/config"
)

// LogRetentionDays mirrors log.ts's LOG_RETENTION_DAYS (D12): a fixed constant, not
// advanced.opLogRetentionDays — that setting is documented as the op log's own retention, and
// silently reusing it here would surprise a user who sets it low to keep the op log small.
const LogRetentionDays = 30

// Sweep deletes kira-*.log files older than LogRetentionDays by mtime — ageing by mtime rather
// than parsing the date out of the filename covers any rotated or renamed file regardless of
// naming scheme, matching log.ts's own comment. Best-effort and total: an unreadable or missing
// logs directory, or a single file that fails to stat/remove, never blocks startup.
func Sweep() {
	dir := config.LogsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-LogRetentionDays * 24 * time.Hour)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, "kira-") || !strings.HasSuffix(name, ".log") {
			continue
		}
		path := filepath.Join(dir, name)
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
		}
	}
}
