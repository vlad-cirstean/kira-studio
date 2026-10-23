package docker

import (
	"sort"
	"time"
)

// Snapshot and item states.
const (
	stateTracking = "tracking"
	statePending  = "pending"

	itemRestorable = "restorable"
	itemWaiting    = "waiting"
	itemBack       = "back"
	itemGone       = "gone"
)

// RestoreEntry is one container that was running at the last healthy tick.
type RestoreEntry struct {
	ID               string
	Name             string
	Image            string
	ComposeProject   string
	ComposeService   string
	ComposeDependsOn string // raw com.docker.compose.depends_on label
	RestartPolicy    string // no | always | unless-stopped | on-failure
	AddedAt          int64  // ms
	StoppedSeenAt    int64  // ms; 0 = running at last tick
}

// RestoreSnapshot is the last known running set of one engine (keyed by Info.ID).
type RestoreSnapshot struct {
	EngineID   string
	Context    string // display only
	Host       string // display only
	BootID     string // default bridge network ID; "" = engine has none
	BootAt     int64  // bridge Created, ms
	State      string // tracking | pending
	DetectedAt int64  // ms, set when State becomes pending
	UpdatedAt  int64  // ms
	Entries    []RestoreEntry
}

// RestoreStore persists one snapshot per engine. Kira Studio's storage repo implements it.
type RestoreStore interface {
	LoadRestore(engineID string) (RestoreSnapshot, bool, error)
	// SaveRestore replaces the engine's row and entries in one transaction.
	SaveRestore(s RestoreSnapshot) error
	PruneRestore(updatedBefore int64) error
}

// RestoreState is the bound result and ChannelRestore payload.
type RestoreState struct {
	State      string        `json:"state"` // none | pending
	EngineID   string        `json:"engineId"`
	Context    string        `json:"context"`
	DetectedAt int64         `json:"detectedAt"`
	BootAt     int64         `json:"bootAt"`
	Items      []RestoreItem `json:"items"` // empty unless pending
}

// RestoreItem is one container of a pending restore.
type RestoreItem struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Image          string `json:"image"`
	ComposeProject string `json:"composeProject"`
	ComposeService string `json:"composeService"`
	Status         string `json:"status"` // restorable | waiting | back | gone
	Error          string `json:"error,omitempty"`
}

// restoreTiming holds the tracker's clocks; flow tests shrink them.
type restoreTiming struct {
	tick       time.Duration
	grace      time.Duration
	policyWait time.Duration
}

var defaultRestoreTiming = restoreTiming{tick: 15 * time.Second, grace: 30 * time.Second, policyWait: 60 * time.Second}

// down is the tick while the engine does not answer.
func (t restoreTiming) down() time.Duration { return 2 * t.tick }

// obsContainer is one engine container as one tick saw it.
type obsContainer struct {
	ID, Name, Image string
	Running         bool
	Excluded        bool // origin the engine's orchestrator or tooling owns
	Project         string
	Service         string
	DependsOn       string
	Policy          string // only filled for containers the tracker inspected
	AutoRemove      bool   // only filled for containers the tracker inspected
	FinishedAt      int64  // ms; only filled in the no-bridge fallback
}

// observation is everything one reachable tick learned.
type observation struct {
	EngineID, Context, Host string
	BootID                  string
	BootAt                  int64
	Containers              []obsContainer
	// UnreachableSince is when this session first saw the engine down (ms); 0 = never.
	UnreachableSince int64
}

func (o observation) index() (byID, byName map[string]obsContainer) {
	byID = make(map[string]obsContainer, len(o.Containers))
	byName = make(map[string]obsContainer, len(o.Containers))
	for _, c := range o.Containers {
		byID[c.ID] = c
		byName[c.Name] = c
	}
	return byID, byName
}

func rebuildTracking(o observation, now int64) RestoreSnapshot {
	s := RestoreSnapshot{
		EngineID: o.EngineID, Context: o.Context, Host: o.Host, BootID: o.BootID, BootAt: o.BootAt,
		State: stateTracking, UpdatedAt: now, Entries: []RestoreEntry{},
	}
	for _, c := range o.Containers {
		if c.Running && !c.Excluded && !c.AutoRemove {
			s.Entries = append(s.Entries, entryOf(c, now))
		}
	}
	sortEntries(s.Entries)
	return s
}

func entryOf(c obsContainer, now int64) RestoreEntry {
	return RestoreEntry{
		ID: c.ID, Name: c.Name, Image: c.Image, ComposeProject: c.Project, ComposeService: c.Service,
		ComposeDependsOn: c.DependsOn, RestartPolicy: c.Policy, AddedAt: now,
	}
}

func sortEntries(es []RestoreEntry) {
	sort.Slice(es, func(i, j int) bool {
		if es[i].Name != es[j].Name {
			return es[i].Name < es[j].Name
		}
		return es[i].ID < es[j].ID
	})
}

// itemStatuses classifies every entry against the live list.
func itemStatuses(s RestoreSnapshot, o observation, now int64, t restoreTiming) []RestoreItem {
	byID, byName := o.index()
	items := make([]RestoreItem, 0, len(s.Entries))
	for _, e := range s.Entries {
		it := RestoreItem{ID: e.ID, Name: e.Name, Image: e.Image, ComposeProject: e.ComposeProject, ComposeService: e.ComposeService}
		c, ok := byID[e.ID]
		switch {
		case ok && c.Running:
			it.Status = itemBack
		case !ok:
			if n, named := byName[e.Name]; named && n.Running {
				it.Status = itemBack
			} else {
				it.Status = itemGone
			}
		case (e.RestartPolicy == "always" || e.RestartPolicy == "unless-stopped") && now-s.BootAt < t.policyWait.Milliseconds():
			it.Status = itemWaiting
		default:
			it.Status = itemRestorable
		}
		items = append(items, it)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].ComposeProject != items[j].ComposeProject {
			return items[i].ComposeProject < items[j].ComposeProject
		}
		return items[i].Name < items[j].Name
	})
	return items
}

func hasOpen(items []RestoreItem) bool {
	for _, it := range items {
		if it.Status == itemRestorable || it.Status == itemWaiting {
			return true
		}
	}
	return false
}

// buildState is the wire view of a snapshot: pending lists its items, anything else is none.
func buildState(s *RestoreSnapshot, o observation, now int64, t restoreTiming) RestoreState {
	st := RestoreState{State: "none", EngineID: o.EngineID, Context: o.Context, Items: []RestoreItem{}}
	if s == nil || s.State != statePending {
		return st
	}
	st.State, st.DetectedAt, st.BootAt = statePending, s.DetectedAt, s.BootAt
	st.Items = itemStatuses(*s, o, now, t)
	return st
}

// reconcile folds one observation into the previous snapshot (nil = none yet) and reports whether
// the result differs from prev and must be saved. Pure: the tracker owns I/O.
func reconcile(prev *RestoreSnapshot, o observation, now int64, t restoreTiming) (RestoreSnapshot, bool) {
	if prev == nil {
		return rebuildTracking(o, now), true
	}
	s := *prev
	s.Entries = append([]RestoreEntry(nil), prev.Entries...)
	s.Context, s.Host = o.Context, o.Host
	if s.State == statePending {
		return reconcilePending(s, o, now, t)
	}
	if cand, ok := detectRestart(s, o, now, t); ok {
		return cand, true
	}
	changed := false
	if o.BootID != "" && o.BootID != s.BootID {
		s.BootID, s.BootAt, changed = o.BootID, o.BootAt, true
	}
	if updateEntries(&s, o, now, t) {
		changed = true
	}
	if changed {
		s.UpdatedAt = now
	}
	return s, changed
}

// reconcilePending keeps a pending snapshot frozen: it follows a further restart and clears once nothing is open.
func reconcilePending(s RestoreSnapshot, o observation, now int64, t restoreTiming) (RestoreSnapshot, bool) {
	changed := false
	if o.BootID != "" && o.BootID != s.BootID {
		s.BootID, s.BootAt, changed = o.BootID, o.BootAt, true
	}
	if !hasOpen(itemStatuses(s, o, now, t)) {
		return rebuildTracking(o, now), true
	}
	if changed {
		s.UpdatedAt = now
	}
	return s, changed
}

// detectRestart returns the pending snapshot when the boot marker moved (or, without a bridge, an
// outage was observed) and something is left to restore.
func detectRestart(s RestoreSnapshot, o observation, now int64, t restoreTiming) (RestoreSnapshot, bool) {
	bootChanged := s.BootID != "" && o.BootID != "" && s.BootID != o.BootID
	outage := s.BootID == "" && o.BootID == "" && o.UnreachableSince > 0
	if !bootChanged && !outage {
		return s, false
	}
	if bootChanged {
		s.BootID, s.BootAt = o.BootID, o.BootAt
	} else {
		s.BootAt = now
		s.Entries = outageEntries(s.Entries, o, t)
	}
	if !hasOpen(itemStatuses(s, o, now, t)) {
		return s, false
	}
	s.State, s.DetectedAt, s.UpdatedAt = statePending, now, now
	return s, true
}

// updateEntries is the steady-state pass: refresh running entries, age out stopped ones past
// grace, add new running containers. It reports whether anything changed.
func updateEntries(s *RestoreSnapshot, o observation, now int64, t restoreTiming) bool {
	changed := false
	byID, _ := o.index()
	known := make(map[string]struct{}, len(s.Entries))
	kept := s.Entries[:0]
	for _, e := range s.Entries {
		known[e.ID] = struct{}{}
		c, ok := byID[e.ID]
		switch {
		case ok && c.Running:
			if e.StoppedSeenAt != 0 {
				e.StoppedSeenAt, changed = 0, true
			}
			if e.Name != c.Name {
				e.Name, changed = c.Name, true
			}
		case e.StoppedSeenAt == 0:
			e.StoppedSeenAt, changed = now, true
		case now-e.StoppedSeenAt >= t.grace.Milliseconds():
			changed = true
			continue
		}
		kept = append(kept, e)
	}
	s.Entries = kept
	for _, c := range o.Containers {
		if _, ok := known[c.ID]; ok || !c.Running || c.Excluded || c.AutoRemove {
			continue
		}
		s.Entries = append(s.Entries, entryOf(c, now))
		changed = true
	}
	if changed {
		sortEntries(s.Entries)
	}
	return changed
}

// outageEntries keeps the entries an observed outage can explain: still running, missing, or
// stopped no earlier than the outage start (minus grace).
func outageEntries(es []RestoreEntry, o observation, t restoreTiming) []RestoreEntry {
	byID, _ := o.index()
	floor := o.UnreachableSince - t.grace.Milliseconds()
	out := make([]RestoreEntry, 0, len(es))
	for _, e := range es {
		c, ok := byID[e.ID]
		if !ok || c.Running || c.FinishedAt >= floor {
			out = append(out, e)
		}
	}
	return out
}
