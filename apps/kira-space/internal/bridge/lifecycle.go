package bridge

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
