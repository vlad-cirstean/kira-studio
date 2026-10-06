package ade

import (
	"log/slog"
	"time"
)

const (
	// archivedLogRetention is how long run and setup logs outlive their task's archive (P177).
	archivedLogRetention = 90 * 24 * time.Hour
	logPurgePeriod       = time.Hour
)

func (b *TaskBoard) purgeArchivedLogs() {
	cutoff := b.deps.Now().Add(-archivedLogRetention).UnixMilli()
	n, err := b.deps.Logs.PurgeArchived(cutoff)
	if err != nil {
		slog.Warn("ade: purge archived logs", "scope", "ade", "err", err)
		return
	}
	if n > 0 {
		slog.Info("ade: purged archived logs", "scope", "ade", "logs", n)
	}
}

// runLogPurge purges once, then hourly until Close.
func (b *TaskBoard) runLogPurge() {
	b.purgeArchivedLogs()
	t := time.NewTicker(logPurgePeriod)
	defer t.Stop()
	for {
		select {
		case <-b.ctx.Done():
			return
		case <-t.C:
			b.purgeArchivedLogs()
		}
	}
}
