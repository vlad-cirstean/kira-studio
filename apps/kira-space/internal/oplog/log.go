// Package oplog is Kira Space's in-memory operation log: a bounded ring of user-initiated git
// writes, plus auto-fetch stops and graph-load failures, shared by every window. Nothing persists; the log resets when the app quits.
package oplog

import (
	"crypto/rand"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/notify"
)

const (
	Capacity        = 500
	maxCommandBytes = 16 << 10
)

const (
	StatusRunning   = "running"
	StatusOK        = "ok"
	StatusError     = "error"
	StatusCancelled = "cancelled"
)

// Record is the wire shape; it matches packages/shared/domain/ops.ts plus Space fields.
type Record struct {
	ID          string  `json:"id"`
	StartedAt   string  `json:"startedAt"`
	DurationMs  *int    `json:"durationMs"`
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`
	Command     *string `json:"command"`
	Error       *string `json:"error"`
	RepoRoot    string  `json:"repoRoot"`
	RepoName    string  `json:"repoName"`
	Source      string  `json:"source"`
	Cancellable bool    `json:"cancellable"`
}

// Meta identifies the operation being started.
type Meta struct{ Kind, RepoRoot, RepoName, Source string }

// Log is the ring. A nil *Log is valid and records nothing.
type Log struct {
	mu      sync.Mutex
	records []*Record // newest first
	cancels map[string]func() bool
	emit    notify.Emitter[Record]
}

// Op is a handle to one running operation. A nil *Op is valid and does nothing.
type Op struct {
	log       *Log
	rec       *Record
	started   time.Time
	command   string
	truncated bool
}

func New() *Log { return &Log{cancels: make(map[string]func() bool)} }

// OnUpdate subscribes to every record change and returns its unsubscribe func.
func (l *Log) OnUpdate(fn func(Record)) func() { return l.emit.Subscribe(fn) }

// Start records a new running operation.
func (l *Log) Start(m Meta) *Op {
	if l == nil {
		return nil
	}
	rec := &Record{
		ID:        rand.Text(),
		StartedAt: kiratime.NowISO(),
		Kind:      m.Kind,
		Status:    StatusRunning,
		RepoRoot:  m.RepoRoot,
		RepoName:  m.RepoName,
		Source:    m.Source,
	}
	o := &Op{log: l, rec: rec, started: time.Now()}
	l.mu.Lock()
	l.records = append(l.records, nil)
	copy(l.records[1:], l.records)
	l.records[0] = rec
	if len(l.records) > Capacity {
		clear(l.records[Capacity:])
		l.records = l.records[:Capacity]
	}
	snap := *rec
	l.mu.Unlock()
	l.emit.Emit(snap)
	return o
}

// Record logs one already-finished operation.
func (l *Log) Record(m Meta, status, errMsg string) {
	l.Start(m).Finish(status, errMsg)
}

// Recent returns up to limit records, newest first.
func (l *Log) Recent(limit int) []Record {
	if l == nil || limit <= 0 {
		return []Record{}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	n := min(limit, len(l.records))
	out := make([]Record, n)
	for i := range out {
		out[i] = *l.records[i]
	}
	return out
}

// Cancel calls the registered cancel func under the log lock, so an op that unregistered
// before releasing its slot is never cancelled after the slot changes hands. It reports
// whether a func was registered and accepted the cancel.
func (l *Log) Cancel(id string) bool {
	if l == nil {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	fn := l.cancels[id]
	return fn != nil && fn()
}

// AddCommand appends one git invocation to the record's command line.
func (o *Op) AddCommand(argv []string) {
	if o == nil || len(argv) == 0 {
		return
	}
	o.log.mu.Lock()
	if o.truncated {
		o.log.mu.Unlock()
		return
	}
	if o.command != "" {
		o.command += " && "
	}
	o.command += renderCommand(argv)
	if len(o.command) > maxCommandBytes {
		cut := maxCommandBytes
		for cut > 0 && !utf8.RuneStart(o.command[cut]) {
			cut--
		}
		o.command = o.command[:cut] + "…"
		o.truncated = true
	}
	cmd := o.command
	o.rec.Command = &cmd
	snap := *o.rec
	o.log.mu.Unlock()
	o.log.emit.Emit(snap)
}

// SetCancel registers fn as the op's cancel handler.
func (o *Op) SetCancel(fn func() bool) {
	if o == nil {
		return
	}
	o.log.mu.Lock()
	if o.rec.Status != StatusRunning {
		o.log.mu.Unlock()
		return
	}
	o.log.cancels[o.rec.ID] = fn
	o.rec.Cancellable = true
	snap := *o.rec
	o.log.mu.Unlock()
	o.log.emit.Emit(snap)
}

// ClearCancel unregisters the cancel handler. Call it before releasing the op's slot.
func (o *Op) ClearCancel() {
	if o == nil {
		return
	}
	o.log.mu.Lock()
	if !o.clearCancelLocked() {
		o.log.mu.Unlock()
		return
	}
	snap := *o.rec
	o.log.mu.Unlock()
	o.log.emit.Emit(snap)
}

// Finish records the outcome. Later calls are ignored.
func (o *Op) Finish(status, errMsg string) {
	if o == nil {
		return
	}
	o.log.mu.Lock()
	if o.rec.Status != StatusRunning {
		o.log.mu.Unlock()
		return
	}
	o.clearCancelLocked()
	ms := int(time.Since(o.started).Milliseconds())
	o.rec.DurationMs = &ms
	o.rec.Status = status
	if errMsg != "" {
		o.rec.Error = &errMsg
	}
	snap := *o.rec
	o.log.mu.Unlock()
	o.log.emit.Emit(snap)
}

func (o *Op) clearCancelLocked() bool {
	if _, ok := o.log.cancels[o.rec.ID]; !ok {
		return false
	}
	delete(o.log.cancels, o.rec.ID)
	o.rec.Cancellable = false
	return true
}

func renderCommand(argv []string) string {
	var b strings.Builder
	b.WriteString("git")
	for _, a := range argv {
		b.WriteByte(' ')
		b.WriteString(quoteArg(a))
	}
	return b.String()
}

func quoteArg(s string) string {
	if s != "" && !strings.ContainsFunc(s, unsafeRune) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func unsafeRune(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return false
	}
	return !strings.ContainsRune("_@%+=:,./-", r)
}
