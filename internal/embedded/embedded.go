// Package embedded holds the lifecycle shared by apps that run an optional embedded server.
package embedded

import (
	"log/slog"
	"sync"
)

// Service is the settings-gated start-once/stop-and-clear lifecycle of an embedded server: a
// mutex-guarded instance (the zero value when stopped), a status snapshot built from it, and the
// boot-time "read the setting, start if it says so, log rather than fail" sequence. Wiring (which
// setting gates it, how the instance is built and closed, what its wire status looks like) stays
// in the owner's StartFn/StopFn/StatusFn closures. Owners lock Mu to read Server directly.
type Service[S comparable, ST any] struct {
	Mu     sync.Mutex
	Server S // the zero value (nil, for every S this package uses — a pointer) means "not running"

	StartFn  func(enable bool) (S, error)
	StopFn   func(S)
	StatusFn func(S, error) ST

	lastErr error // last start failure; cleared by a successful start or a stop. Guarded by Mu.
}

func (e *Service[S, ST]) StatusLocked() ST {
	return e.StatusFn(e.Server, e.lastErr)
}

// Status reads the embedded instance's current state — never starts or stops anything.
func (e *Service[S, ST]) Status() ST {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	return e.StatusLocked()
}

// startLocked constructs and starts a new embedded instance if one is not already running. Mu must
// be held by the caller.
func (e *Service[S, ST]) startLocked(enable bool) error {
	var zero S
	if e.Server != zero {
		return nil
	}
	srv, err := e.StartFn(enable)
	if err != nil {
		e.lastErr = err
		return err
	}
	e.lastErr = nil
	e.Server = srv
	return nil
}

// stopLocked stops and drops the embedded instance, if any. Mu must be held by the caller.
func (e *Service[S, ST]) stopLocked() {
	e.lastErr = nil
	var zero S
	if e.Server == zero {
		return
	}
	e.StopFn(e.Server)
	e.Server = zero
}

// StartIfEnabled is main.go's own boot-time call: a failure (curl missing, a bind conflict) is
// logged, never fatal — the app boots regardless. enabledSetting reads the owning service's own
// settings leaf (DbMcp.ServerEnabled, the sole Service user post-P127).
func (e *Service[S, ST]) StartIfEnabled(scope string, enabledSetting func() (bool, error)) {
	ok, err := enabledSetting()
	if err != nil {
		slog.Warn(scope+": read settings at boot", "scope", scope, "err", err)
		return
	}
	if !ok {
		return
	}
	e.Mu.Lock()
	defer e.Mu.Unlock()
	if err := e.startLocked(false); err != nil {
		slog.Warn(scope+": start at boot", "scope", scope, "err", err)
	}
}

// stop is main.go's own shutdown call.
func (e *Service[S, ST]) Stop() {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	e.stopLocked()
}

// SetRunning is SetEnabled's own mutex-guarded lifecycle step, run AFTER the caller has already
// persisted+emitted the settings patch (the patch shape and emitted event differ per service, so
// that step stays in each SetEnabled itself): start (enable=true) or stop (enable=false) the
// embedded instance, returning the resulting status snapshot. A start failure is returned
// alongside the (now-stopped) status rather than swallowed — SetEnabled's own caller logs it and
// folds it into the wire Error field, exactly as its non-generic predecessor did.
func (e *Service[S, ST]) SetRunning(enable bool) (ST, error) {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	if enable {
		if err := e.startLocked(true); err != nil {
			return e.StatusLocked(), err
		}
	} else {
		e.stopLocked()
	}
	return e.StatusLocked(), nil
}
