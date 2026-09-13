// Package localauth is P14's reveal gate: the app's own front door to the operating system's
// device-owner authentication (macOS's LocalAuthentication.framework, Touch ID with a
// system-password fallback), used by internal/connections.Service.Reveal to confirm a person
// before a saved credential is decrypted for display.
//
// Every decision this package makes lives in this file, which carries no build tag, so a plain
// `go test` on Linux genuinely exercises the whole gate (P7 §1.4's rule, mirrored from
// internal/secrets/cipher.go's probe). evaluate_darwin.go and evaluate_other.go are mechanical,
// logic-free platform shims that only answer two questions this file asks them: can OS auth run
// at all right now, and — if so — did it just succeed.
package localauth

import (
	"log/slog"
	"sync"
	"time"
)

// Outcome is Authorize's own vocabulary for "was OS authentication itself satisfied" — narrower
// than connections.RevealResult's four outcomes (P14 D6): "confirmation-required" is Reveal's own
// synthesis of Unavailable plus a renderer that hasn't confirmed yet, not something this package
// needs to name, and a genuine evaluate failure is reported through Authorize's returned error
// instead of a fourth Outcome value — exactly one caller (Reveal, only on the OS-auth-available
// branch) ever needs to tell "the prompt errored" apart from an ordinary Cancelled.
type Outcome int

const (
	Granted Outcome = iota
	Cancelled
	Unavailable
)

func (o Outcome) String() string {
	switch o {
	case Granted:
		return "granted"
	case Cancelled:
		return "cancelled"
	case Unavailable:
		return "unavailable"
	default:
		return "unknown"
	}
}

// GraceWindow is D5's fixed, non-sliding grace period: once evaluate() succeeds, a reveal inside
// this window is granted with no further prompt. Fixed from the moment of the grant rather than
// sliding on every use, so a long editing session can't hold one authentication open indefinitely.
// F8 is why it exists at all: the real prompt-storm risk is per-dialog-open (open A, reveal,
// close; open B, reveal; reopen A, reveal — three prompts in thirty seconds), not per-keystroke,
// and that is exactly the friction that gets a security feature disabled.
const GraceWindow = 5 * time.Minute

// EvaluateFunc is the platform OS-auth call, injected (rather than called directly) so
// Authorize's own decision table stays platform-free and covered by a plain Linux `go test` — the
// same seam secrets.probe uses for loadOrCreateKey. evaluate_darwin.go's cgo shim over
// LAContext.evaluatePolicy is the only real implementation; evaluate_other.go's is never called
// (Authorize only calls evaluate when available() has already answered true).
type EvaluateFunc func(reason string) (Outcome, error)

// AvailableFunc reports whether OS authentication can be attempted at all on this build and this
// machine — checked before every evaluate() call so Authorize never attempts a prompt on a
// platform, or a Mac with neither biometry nor a login password, that cannot honour it.
type AvailableFunc func() bool

// Authorizer implements P14 D6's whole reveal-gate decision table. Safe for concurrent use —
// Wails bound-service calls each run on their own goroutine (never the main thread), so two
// windows' Reveal calls can race here for real.
type Authorizer struct {
	now       func() time.Time
	evaluate  EvaluateFunc
	available AvailableFunc

	mu       sync.Mutex
	deadline time.Time // zero value = no live grant
}

// New constructs an Authorizer and logs its availability once, the same "probe once, log once at
// startup" shape secrets.New/cipher.go's New use for their own backend status — so a build that
// silently landed on the weak (Unavailable, in-app-confirm-only) path says so out loud rather than
// leaving that discoverable only by pressing "Show password" once. now/evaluate/available are
// injected for testability (D9) — production wiring is main.go passing time.Now alongside this
// package's own platform-selected Evaluate/Available.
func New(now func() time.Time, evaluate EvaluateFunc, available AvailableFunc) *Authorizer {
	avail := available()
	msg := "local authentication: available=" + boolString(avail)
	if avail {
		slog.Info(msg, "scope", "localauth")
	} else {
		slog.Warn(msg+" — reveals fall back to an in-app confirmation", "scope", "localauth")
	}
	return &Authorizer{now: now, evaluate: evaluate, available: available}
}

func boolString(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// Authorize is P14 D6's table, one reveal request at a time. confirmed is honoured only on the
// branch where available() is false (mirrors the comment on bridge.ConnectionsRevealArgs.Confirmed)
// — on a machine where LocalAuthentication actually works, this argument cannot influence the
// result, so a renderer cannot skip a real prompt by simply lying about having already shown one.
func (a *Authorizer) Authorize(reason string, confirmed bool) (Outcome, error) {
	a.mu.Lock()
	live := !a.deadline.IsZero() && a.now().Before(a.deadline)
	a.mu.Unlock()
	if live {
		return Granted, nil
	}

	if !a.available() {
		if confirmed {
			// D5: the in-app confirm is a deliberate-action gate, not an authentication — it
			// grants this one reveal but records no grace, unlike a real evaluate() success.
			// Re-opening another dialog inside the "grace window" still asks again.
			return Granted, nil
		}
		return Unavailable, nil
	}

	outcome, err := a.evaluate(reason)
	if err != nil {
		return outcome, err
	}
	if outcome == Granted {
		a.mu.Lock()
		a.deadline = a.now().Add(GraceWindow)
		a.mu.Unlock()
	}
	return outcome, nil
}
