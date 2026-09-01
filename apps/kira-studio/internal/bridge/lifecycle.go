package bridge

// Flusher is the quit-handshake ack seam. *shell.Quitter satisfies it; lifecycle_test.go uses a
// recorder.
type Flusher interface{ Flushed() }

// WindowFlusher is the per-window close-flush ack seam (P8 C6, F8's fix) — a separate handshake
// from the quit one above: at most one window is ever waiting on it at a time, keyed by which
// window is currently closing, rather than every window at once. *shell.CloseFlushCoordinator
// satisfies it.
type WindowFlusher interface{ Ack(windowKey string) }

// LifecycleService is IPC.appFlushed/IPC.windowFlushed's two methods — renderer→Go
// fire-and-forget channels (P52 §7.1). Neither returns anything and neither can fail: a nil
// Flusher/WindowFlusher (a build with no window, e.g. a test) is a no-op, not an error.
type LifecycleService struct {
	Flusher       Flusher
	WindowFlusher WindowFlusher
}

func (s *LifecycleService) Flushed() {
	if s.Flusher != nil {
		s.Flusher.Flushed()
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
