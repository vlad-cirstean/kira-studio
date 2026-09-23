package bridge

import (
	"log/slog"
	"sync"
)

// embeddedService is the settings-gated start-once/stop-and-clear lifecycle AgentHooksService and
// DbMcpService each rebuilt around their own embedded server (T2-13): a mutex-guarded instance
// (the zero value when stopped), a status snapshot built from it, start-once/stop-and-clear
// guards, and the boot-time "read the setting, start if it says so, log rather than fail"
// sequence. Wiring — which setting gates it, how the instance is actually constructed/closed, what
// its wire status looks like — stays in each owning service's own start/stop/status closures (set
// once, in that service's own New constructor, since they close over the owning service's own
// fields): DbMcp's own status layers in Installer.Status() even while stopped and its own start
// takes a mint flag agenthooks has no equivalent of — differences a shared struct cannot
// generalize away.
type embeddedService[S comparable, ST any] struct {
	mu     sync.Mutex
	server S // the zero value (nil, for every S this package uses — a pointer) means "not running"

	startFn  func(enable bool) (S, error)
	stopFn   func(S)
	statusFn func(S) ST
}

func (e *embeddedService[S, ST]) statusLocked() ST {
	return e.statusFn(e.server)
}

// Status reads the embedded instance's current state — never starts or stops anything.
func (e *embeddedService[S, ST]) Status() ST {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.statusLocked()
}

// startLocked constructs and starts a new embedded instance if one is not already running. mu must
// be held by the caller.
func (e *embeddedService[S, ST]) startLocked(enable bool) error {
	var zero S
	if e.server != zero {
		return nil
	}
	srv, err := e.startFn(enable)
	if err != nil {
		return err
	}
	e.server = srv
	return nil
}

// stopLocked stops and drops the embedded instance, if any. mu must be held by the caller.
func (e *embeddedService[S, ST]) stopLocked() {
	var zero S
	if e.server == zero {
		return
	}
	e.stopFn(e.server)
	e.server = zero
}

// startIfEnabled is main.go's own boot-time call: a failure (curl missing, a bind conflict) is
// logged, never fatal — the app boots regardless. enabledSetting reads the owning service's own
// settings leaf (ClaudeCode.HooksEnabled / DbMcp.ServerEnabled).
func (e *embeddedService[S, ST]) startIfEnabled(scope string, enabledSetting func() (bool, error)) {
	ok, err := enabledSetting()
	if err != nil {
		slog.Warn(scope+": read settings at boot", "scope", scope, "err", err)
		return
	}
	if !ok {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.startLocked(false); err != nil {
		slog.Warn(scope+": start at boot", "scope", scope, "err", err)
	}
}

// stop is main.go's own shutdown call.
func (e *embeddedService[S, ST]) stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stopLocked()
}

// setRunning is SetEnabled's own mutex-guarded lifecycle step, run AFTER the caller has already
// persisted+emitted the settings patch (the patch shape and emitted event differ per service, so
// that step stays in each SetEnabled itself): start (enable=true) or stop (enable=false) the
// embedded instance, returning the resulting status snapshot. A start failure is returned
// alongside the (now-stopped) status rather than swallowed — SetEnabled's own caller logs it and
// folds it into the wire Error field, exactly as its non-generic predecessor did.
func (e *embeddedService[S, ST]) setRunning(enable bool) (ST, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if enable {
		if err := e.startLocked(true); err != nil {
			return e.statusLocked(), err
		}
	} else {
		e.stopLocked()
	}
	return e.statusLocked(), nil
}
