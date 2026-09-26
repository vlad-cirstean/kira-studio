package keepawake

import "sync"

// State is one snapshot of the manual keep-awake toggle. Manual is the titlebar button's own
// on/off state — app-wide, process-scoped, never persisted across relaunch (§3.2). Supported
// forwards the driver's own Supported() — false hides the button outright rather than offering a
// control that does nothing. Error names why an acquire failed ("" otherwise). Both apps' own
// bound KeepAwakeService wire type mirrors this field for field.
type State struct {
	Manual    bool
	Supported bool
	Error     string
}

// Toggle owns the manual keep-awake reason (ReasonManual) on top of a Controller — the half every
// app's own titlebar button drives. An app with another reason of its own (Kira Studio's
// agent-aware setting, ReasonAgent) sets it directly on the same Controller; Toggle only ever
// touches ReasonManual.
type Toggle struct {
	Ctl *Controller

	mu     sync.Mutex
	manual bool
}

// State reads the toggle's current state — never starts or stops anything.
func (t *Toggle) State() State {
	st := State{Supported: t.Ctl.Supported()}
	t.mu.Lock()
	st.Manual = t.manual
	t.mu.Unlock()
	if err := t.Ctl.Err(); err != nil {
		st.Error = err.Error()
	}
	return st
}

// SetManual flips the manual reason on the underlying Controller and returns the resulting state —
// the caller decides what to do with it (broadcast it over its own wire type).
func (t *Toggle) SetManual(on bool) State {
	t.mu.Lock()
	t.manual = on
	t.mu.Unlock()
	t.Ctl.Set(ReasonManual, on)
	return t.State()
}
