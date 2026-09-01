// Package logging installs the process-wide slog default that internal/storage/repos and
// internal/enginehost already log through (P53/P54's late-bound seam) — a daily-rolling file
// under KIRA_HOME/logs, mirroring src/main/log.ts's electron-log configuration.
package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
)

// dailyWriter re-resolves the dated log filename on every Write and reopens the file when the
// date changes, matching electron-log's resolvePathFn being evaluated per write — a long-running
// session's log rolls over at local midnight rather than staying pinned to the file open at
// startup.
type dailyWriter struct {
	mu       sync.Mutex
	now      func() time.Time
	dir      string
	openDate string
	file     *os.File
}

func newDailyWriter(dir string, now func() time.Time) *dailyWriter {
	return &dailyWriter{dir: dir, now: now}
}

func (w *dailyWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	date := w.now().Format("2006-01-02")
	if date != w.openDate {
		if w.file != nil {
			_ = w.file.Close()
		}
		path := filepath.Join(w.dir, "kira-"+date+".log")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return 0, err
		}
		w.file = f
		w.openDate = date
	}
	return w.file.Write(p)
}

// Init installs a slog handler writing to KIRA_HOME/logs/kira-YYYY-MM-DD.log as the process
// default, so every existing slog.Default() call in storage/repos and enginehost lands there
// with zero change to those packages (P54 §1.6). In a dev build the same records also go to
// stderr, mirroring electron-log's console transport (silenced only under NODE_ENV=test, which
// has no Go analogue since tests here use their own captured logger, per P54's helpers_test.go).
func Init() error {
	dir := config.LogsDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	var w io.Writer = newDailyWriter(dir, time.Now)
	if config.IsDev() {
		w = io.MultiWriter(w, os.Stderr)
	}

	slog.SetDefault(slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return nil
}
