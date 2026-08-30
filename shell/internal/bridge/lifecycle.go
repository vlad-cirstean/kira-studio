package bridge

// Flusher is the ack seam. *shell.Quitter satisfies it; lifecycle_test.go uses a recorder.
type Flusher interface{ Flushed() }

// LifecycleService is IPC.appFlushed's one method — the only renderer→Go fire-and-forget channel
// in the whole surface (P52 §7.1). It returns nothing and cannot fail: a nil Flusher (a build
// with no window, e.g. a test) is a no-op, not an error.
type LifecycleService struct {
	Flusher Flusher
}

func (s *LifecycleService) Flushed() {
	if s.Flusher != nil {
		s.Flusher.Flushed()
	}
}
