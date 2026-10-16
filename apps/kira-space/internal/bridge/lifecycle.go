package bridge

import "github.com/kirathecat/kira-studio/internal/shell"

// Flusher is the quit-handshake ack seam — Kira Studio's own bridge.Flusher (internal/bridge/
// lifecycle.go), *shell.Quitter satisfies it here too.
type Flusher interface{ Flushed(windowKey string) }

// WindowFlusher is the per-window close-flush ack seam — Kira Studio's own bridge.WindowFlusher, a
// separate handshake from the quit one above: at most one window is ever waiting on it at a time.
// *shell.CloseFlushCoordinator satisfies it.
type WindowFlusher interface{ Ack(windowKey string) }

// LifecycleService is IPC.appFlushed/IPC.windowFlushed's two methods — renderer->Go
// fire-and-forget channels. Neither returns anything and neither can fail: a nil
// Flusher/WindowFlusher (a build with no window, e.g. a test) is a no-op, not an error.
type LifecycleService struct {
	Flusher       Flusher
	WindowFlusher WindowFlusher
	// Quit answers the quit confirmation popup; Live counts the work a quit would stop.
	Quit QuitControl
	Live func() shell.QuitStatus
}

// QuitControl is the quit-confirmation seam. *shell.Quitter satisfies it.
type QuitControl interface {
	ConfirmQuit()
	CancelQuit()
	Asking() bool
}

type LifecycleFlushedArgs struct {
	WindowKey string `json:"windowKey"`
}

func (s *LifecycleService) Flushed(args LifecycleFlushedArgs) {
	if s.Flusher != nil {
		s.Flusher.Flushed(args.WindowKey)
	}
}

type LifecycleWindowFlushedArgs struct {
	WindowKey string `json:"windowKey"`
}

func (s *LifecycleService) WindowFlushed(args LifecycleWindowFlushedArgs) {
	if s.WindowFlusher != nil {
		s.WindowFlusher.Ack(args.WindowKey)
	}
}

// ConfirmQuit is the popup's "Quit anyway". Fire-and-forget like Flushed.
func (s *LifecycleService) ConfirmQuit() {
	if s.Quit != nil {
		s.Quit.ConfirmQuit()
	}
}

// CancelQuit is the popup's Cancel.
func (s *LifecycleService) CancelQuit() {
	if s.Quit != nil {
		s.Quit.CancelQuit()
	}
}

// QuitStatus is the live work the confirmation popup lists.
func (s *LifecycleService) QuitStatus() (shell.QuitStatus, error) {
	var st shell.QuitStatus
	if s.Live != nil {
		st = s.Live()
	}
	st.Asking = s.Quit != nil && s.Quit.Asking()
	return st, nil
}
