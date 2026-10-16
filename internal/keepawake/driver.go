package keepawake

import (
	"log/slog"
	"runtime"
)

// Driver is one OS's keep-awake assertion — acquire/release, exactly the pair SPEC names. Acquire
// is called only when nothing is held; Release only when something is (Controller's own §1.3
// invariant, enforced by acquireLocked/releaseLocked never being called out of turn).
type Driver interface {
	Acquire() error
	Release()
	Supported() bool
}

// NewPlatformDriver selects the darwin driver on macOS and a documented no-op everywhere else
// (SPEC: "every other OS stays a documented no-op") — NewPlatformLocator's own shape
// (internal/gitclient/discovery.go).
func NewPlatformDriver() Driver {
	if runtime.GOOS == "darwin" {
		return newCaffeinateDriver()
	}
	return noopDriver{platform: runtime.GOOS}
}

// noopDriver is a real, honest no-op, not a stub error — the renderer hides the titlebar control
// entirely when Supported() is false (§3.1/§8.2), so no user ever gets a button that silently does
// nothing.
type noopDriver struct{ platform string }

func (d noopDriver) Acquire() error {
	slog.Debug("keepawake: no-op driver, acquire is a no-op", "scope", "keepawake", "platform", d.platform)
	return nil
}

func (noopDriver) Release()        {}
func (noopDriver) Supported() bool { return false }
