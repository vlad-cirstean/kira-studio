package shell

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// windowEntry is one open window's live handle plus its shell.Attach cleanup.
type windowEntry struct {
	win    *application.WebviewWindow
	detach func()
}

// WindowRegistry tracks every currently open window by its key (P8 C2). Window creation runs on
// the menu-click/reopen-handler goroutine and beforeFlush runs on the quit goroutine, so this is
// mutex-guarded — unlike the single `detachWindow`/`mainWindow` package vars it replaces, which
// only ever worked because at most one window could exist at a time (F4).
type WindowRegistry struct {
	mu      sync.Mutex
	entries map[string]windowEntry
}

func NewWindowRegistry() *WindowRegistry {
	return &WindowRegistry{entries: map[string]windowEntry{}}
}

// Add registers a newly opened window under key, replacing whatever was registered there before.
// A reopened window reusing its old key is exactly what used to detach window 1's listeners the
// moment window 2 was created (F4) — now each key gets its own slot, so one key's Add can never
// clobber another key's entry.
func (r *WindowRegistry) Add(key string, win *application.WebviewWindow, detach func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries[key] = windowEntry{win: win, detach: detach}
}

// DetachAll runs every registered window's detach exactly once. This is beforeFlush's whole job:
// the code this replaces detached only the single most-recently-created window, so an earlier
// window's bounds listener would keep firing into a WindowsRepo whose *sql.DB teardown had
// already closed (P2 R1's finding, now true per-window instead of only for the newest one).
func (r *WindowRegistry) DetachAll() {
	r.mu.Lock()
	detaches := make([]func(), 0, len(r.entries))
	for _, e := range r.entries {
		detaches = append(detaches, e.detach)
	}
	r.mu.Unlock()
	for _, detach := range detaches {
		detach()
	}
}

// Count reports how many windows are currently registered — AttachCloseFlush's own real-interaction
// fix (item 8: the webview-process leak) reads this immediately before deciding how a window's
// close finishes: 1 means the window asking is the last one, so closing it would otherwise leave
// the app running (Mac.ApplicationShouldTerminateAfterLastWindowClosed: false, main.go) with no
// window able to bring its own now-orphaned webview process back — Hide (reused on the next
// Dock-click/menu reopen) replaces Close there instead of adding to the leak. Read at the same
// registry snapshot RemoveAndCount already coordinates through the same mutex, so a window closing
// at the same instant as another can't race this decision either.
func (r *WindowRegistry) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.entries)
}

// Any returns one live window, or nil if none is registered — attachDialogs' fallback for when
// app.Window.Current() can't resolve a key window (F4's second half: a dialog used to always
// attach to whichever window was created most recently, not the one that asked).
func (r *WindowRegistry) Any() application.Window {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.entries {
		return e.win
	}
	return nil
}

// Keys returns every currently registered window's key — Quitter's LiveWindowKeys seam (P8 C8):
// which windows the quit handshake must wait for is decided at the moment quitting actually
// starts, not fixed at construction time.
func (r *WindowRegistry) Keys() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	keys := make([]string, 0, len(r.entries))
	for k := range r.entries {
		keys = append(keys, k)
	}
	return keys
}

// RemoveAndCount unregisters key (a no-op if it was never registered, e.g. a duplicate close
// event) and runs its detach, then reports how many windows remain registered — one atomic
// operation so a window closing at the same instant as another can't race the decision D5 makes
// from the result: only the close that empties the registry keeps that window's `windows` row
// (so a later Dock click restores the same workbench); every other close deletes its row.
func (r *WindowRegistry) RemoveAndCount(key string) (remaining int) {
	r.mu.Lock()
	e, ok := r.entries[key]
	if ok {
		delete(r.entries, key)
	}
	remaining = len(r.entries)
	r.mu.Unlock()
	if ok {
		e.detach()
	}
	return remaining
}
