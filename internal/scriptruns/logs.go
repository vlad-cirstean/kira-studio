package scriptruns

import (
	"log/slog"
	"strings"
	"sync"
	"time"
)

const (
	logFlushInterval = 250 * time.Millisecond
	maxLogLineBytes  = 2 << 10
)

// LogPush is what a run's log pushes carry: the chunks just stored.
type LogPush struct {
	RunID  string     `json:"runId"`
	Chunks []LogChunk `json:"chunks"`
}

// logSink buffers one run's lines, stores them as a batch and pushes the stored chunks. Safe for
// concurrent add.
type logSink struct {
	svc   *Service
	runID string

	flushMu sync.Mutex // keeps stored seq order equal to push order
	mu      sync.Mutex
	seq     int
	pending []LogChunk
	timer   *time.Timer
	lastErr string
}

func newLogSink(svc *Service, runID string) *logSink { return &logSink{svc: svc, runID: runID} }

func (l *logSink) add(stream, text string) {
	if len(text) > maxLogLineBytes {
		text = strings.ToValidUTF8(text[:maxLogLineBytes], "") + "…"
	}
	l.mu.Lock()
	l.seq++
	l.pending = append(l.pending, LogChunk{Seq: l.seq, Stream: stream, Text: text})
	if stream == "stderr" && strings.TrimSpace(text) != "" {
		l.lastErr = text
	}
	if l.timer == nil {
		l.timer = time.AfterFunc(logFlushInterval, l.flush)
	}
	l.mu.Unlock()
}

// lastStderr is the last non-blank stderr line added.
func (l *logSink) lastStderr() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.lastErr
}

// flush stores and pushes what is pending; also the final flush when a run ends.
func (l *logSink) flush() {
	l.flushMu.Lock()
	defer l.flushMu.Unlock()
	l.mu.Lock()
	batch := l.pending
	l.pending = nil
	if l.timer != nil {
		l.timer.Stop()
		l.timer = nil
	}
	l.mu.Unlock()
	if len(batch) == 0 {
		return
	}
	if err := l.svc.Runs.AppendLogs(l.runID, batch); err != nil {
		slog.Warn("scriptruns: append log", "scope", "scriptruns", "run", l.runID, "err", err)
		return
	}
	if l.svc.EmitLog != nil {
		l.svc.EmitLog(LogPush{RunID: l.runID, Chunks: batch})
	}
}
