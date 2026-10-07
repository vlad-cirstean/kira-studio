package ade

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

const noteInterrupted = "interrupted by restart"

// Recover settles what the previous process life left behind (D7, R9): running runs become stuck,
// running setups failed, session rows stopped, orphaned MCP configs go. Held (pending) runs keep their launch spec and launch when their gate opens. Nothing resumes by itself.
// Call it once at boot, before Start and before any window exists.
func (b *TaskBoard) Recover() error {
	now := b.deps.Now().UnixMilli()
	runs, err := b.deps.Tasks.RecoverRunning(now, noteInterrupted)
	if err != nil {
		return fmt.Errorf("ade: recover: %w", err)
	}
	failed, err := b.deps.Tasks.FailRunningSetups(now)
	if err != nil {
		return fmt.Errorf("ade: recover: %w", err)
	}
	for _, sb := range failed {
		line := []repos.AdeLogChunk{{At: now, Stream: logEvent, Text: noteInterrupted}}
		if _, err := b.deps.Logs.Append(repos.AdeLogSetup, sb.ID, line); err != nil {
			slog.Warn("ade: recover: setup log", "scope", "ade", "branch", sb.ID, "err", err)
		}
		b.setPendingNote(sb.ID, noteSetupFailed)
	}
	if err := b.deps.Sessions.StopAllTaskRunning(now); err != nil {
		return fmt.Errorf("ade: recover: %w", err)
	}
	if b.deps.AgentDir != "" {
		stale, _ := filepath.Glob(filepath.Join(b.deps.AgentDir, "*.mcp.json"))
		for _, f := range stale {
			if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
				slog.Warn("ade: recover: remove mcp config", "scope", "ade", "file", f, "err", err)
			}
		}
	}
	b.snapshotStartedTasks()
	b.emitRuns(runs...)
	b.notifySessions()
	b.notifyBoard()
	return nil
}
