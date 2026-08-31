package testsupport

import "sync"

// fixture memoizes one expensive resource (typically a real container) per test binary: started
// lazily on the first get() call and reused by every later call in the same process. Stop is
// called exactly once, from the package's own TestMain after m.Run() returns — never from an
// individual test's t.Cleanup, which Go's testing package runs the instant the registering test
// function itself returns, long before the rest of the package's tests run. That is the bug P58a's
// own findings record (AGENTS.md): the first StartPostgres implementation wired termination to
// t.Cleanup and silently restarted a fresh container for every single test instead of reusing one,
// turning an ~8s suite into ~50s. This type exists so a fourth fixture cannot re-discover it.
type fixture[T any] struct {
	mu  sync.Mutex
	val *T
	err error
}

// get returns the memoized value, calling start() at most once. A prior failure from start() is
// remembered and returned again rather than retried, matching bun:test's own beforeAll semantics
// (a failed beforeAll fails every test in the file, not just the first).
func (f *fixture[T]) get(start func() (*T, error)) (*T, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.val != nil {
		return f.val, nil
	}
	if f.err != nil {
		return nil, f.err
	}
	val, err := start()
	if err != nil {
		f.err = err
		return nil, err
	}
	f.val = val
	return val, nil
}

// stop calls terminate on the memoized value, if one was ever started, and clears the fixture so a
// later get() (a later, independent test binary run in the same process — not expected in
// practice, but cheap to make correct) starts fresh.
func (f *fixture[T]) stop(terminate func(*T)) {
	f.mu.Lock()
	val := f.val
	f.val = nil
	f.err = nil
	f.mu.Unlock()
	if val != nil {
		terminate(val)
	}
}
