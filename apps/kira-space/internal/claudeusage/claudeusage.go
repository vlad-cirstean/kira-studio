// Package claudeusage keeps the latest Claude Code rate-limit windows (5-hour and weekly) that
// Kira-started sessions report. Two feeds, no credential and no network call: an interactive
// session's statusline payload and a headless run's stream-json rate_limit_event. The newest
// reading wins per window. Only the numbers are persisted, never a payload.
package claudeusage

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Snapshot states.
const (
	StateOK      = "ok"
	StateWaiting = "waiting"
	StateOff     = "off"
)

// Feed names.
const (
	SourceSession = "session"
	SourceRun     = "run"
)

// WaitingDetail is the hint shown while no session has reported yet.
const WaitingDetail = "Start a Claude Code session to see usage"

// emitInterval bounds OnChange to one call per interval.
const emitInterval = 10 * time.Second

// Window is one rate-limit window; ResetsAt is Unix milliseconds.
type Window struct {
	UsedPercent float64 `json:"usedPercent"`
	ResetsAt    int64   `json:"resetsAt"`
}

// Snapshot is the wire shape of the status-bar item.
type Snapshot struct {
	State     string  `json:"state"`
	Source    string  `json:"source"`
	FiveHour  *Window `json:"fiveHour"`
	SevenDay  *Window `json:"sevenDay"`
	UpdatedAt int64   `json:"updatedAt"`
	Detail    string  `json:"detail"`
}

// FromSession converts a statusline window: percent 0-100, reset in epoch seconds.
func FromSession(percent float64, resetsAtSeconds int64) *Window {
	return &Window{UsedPercent: clamp(percent), ResetsAt: resetsAtSeconds * 1000}
}

// FromRun converts a stream-json window: utilization is a 0..1 fraction, reset in epoch seconds.
func FromRun(utilization float64, resetsAtSeconds int64) *Window {
	return &Window{UsedPercent: clamp(utilization * 100), ResetsAt: resetsAtSeconds * 1000}
}

func clamp(p float64) float64 {
	return min(max(p, 0), 100)
}

// Deps wires the Service.
type Deps struct {
	// Enabled reads claudeCode.usageEnabled fresh on every call.
	Enabled func() bool
	// Path is the persisted snapshot file ("" disables persistence).
	Path string
	Now  func() time.Time
	// OnChange fires after a changed reading, at most once per 10 s.
	OnChange func()
}

// Service holds the last known windows.
type Service struct {
	deps Deps

	mu       sync.Mutex
	five     *Window
	seven    *Window
	source   string
	updated  int64
	lastEmit time.Time
}

// New loads the persisted snapshot, if any.
func New(deps Deps) *Service {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	if deps.Enabled == nil {
		deps.Enabled = func() bool { return true }
	}
	s := &Service{deps: deps}
	s.load()
	return s
}

// Ingest merges a reading: a non-nil window replaces the stored one, a nil window keeps it.
func (s *Service) Ingest(source string, five, seven *Window) {
	if !s.deps.Enabled() || (five == nil && seven == nil) {
		return
	}
	s.mu.Lock()
	changed := false
	if five != nil && (s.five == nil || *s.five != *five) {
		s.five, changed = five, true
	}
	if seven != nil && (s.seven == nil || *s.seven != *seven) {
		s.seven, changed = seven, true
	}
	if !changed {
		s.mu.Unlock()
		return
	}
	now := s.deps.Now()
	s.source, s.updated = source, now.UnixMilli()
	s.persistLocked()
	emit := s.deps.OnChange != nil && now.Sub(s.lastEmit) >= emitInterval
	if emit {
		s.lastEmit = now
	}
	s.mu.Unlock()
	if emit {
		s.deps.OnChange()
	}
}

// Get returns the current snapshot; a window whose reset time passed is dropped, as the CLI does.
func (s *Service) Get() Snapshot {
	if !s.deps.Enabled() {
		return Snapshot{State: StateOff}
	}
	nowMs := s.deps.Now().UnixMilli()
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := Snapshot{Source: s.source, UpdatedAt: s.updated}
	if s.five != nil && s.five.ResetsAt > nowMs {
		w := *s.five
		snap.FiveHour = &w
	}
	if s.seven != nil && s.seven.ResetsAt > nowMs {
		w := *s.seven
		snap.SevenDay = &w
	}
	if snap.FiveHour == nil && snap.SevenDay == nil {
		return Snapshot{State: StateWaiting, Detail: WaitingDetail}
	}
	snap.State = StateOK
	return snap
}

type stored struct {
	FiveHour  *Window `json:"fiveHour"`
	SevenDay  *Window `json:"sevenDay"`
	Source    string  `json:"source"`
	UpdatedAt int64   `json:"updatedAt"`
}

func (s *Service) load() {
	if s.deps.Path == "" {
		return
	}
	raw, err := os.ReadFile(s.deps.Path)
	if err != nil {
		return
	}
	var st stored
	if json.Unmarshal(raw, &st) != nil {
		return
	}
	s.five, s.seven, s.source, s.updated = st.FiveHour, st.SevenDay, st.Source, st.UpdatedAt
}

// persistLocked writes the numbers atomically; a failure only costs the restart carry-over.
func (s *Service) persistLocked() {
	if s.deps.Path == "" {
		return
	}
	raw, err := json.Marshal(stored{FiveHour: s.five, SevenDay: s.seven, Source: s.source, UpdatedAt: s.updated})
	if err != nil {
		return
	}
	if err := writeAtomic(s.deps.Path, raw); err != nil {
		slog.Warn("claude usage: persist", "scope", "usage", "err", err)
	}
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".claude-usage-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
