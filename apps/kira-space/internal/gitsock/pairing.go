package gitsock

import (
	"time"

	"github.com/kirathecat/kira-studio/internal/pairing"
)

// Fixed windows: 120s from enqueue (not from being presented), 60s cooldown on an explicit deny
// only.
const (
	pairingTimeout  = 120 * time.Second
	pairingCooldown = 60 * time.Second
)

// maxQueueLen bounds the broker queue: clientID is client-supplied and unauthenticated until a
// pairing decision, so nothing else stops a local process from enqueueing a request on every
// connection it opens. Beyond the cap Request aborts immediately (aborted, not denied: capacity is
// not a decision about this client).
const maxQueueLen = 200

// PairingMeta is the git-specific request metadata the shared broker carries.
type PairingMeta struct {
	Label string // client-reported.
	Peer  Peer   // kernel-reported.
}

type (
	PairingRequest      = pairing.Request[PairingMeta]
	PairingSnapshot     = pairing.Snapshot[PairingMeta]
	PairingOutcome      = pairing.Outcome
	PairingActionResult = pairing.ActionResult
	Broker              = pairing.Broker[PairingMeta]
)

const (
	PairingApproved = pairing.Approved
	PairingDenied   = pairing.Denied
	PairingTimedOut = pairing.TimedOut
	PairingAborted  = pairing.Aborted

	PairingActionResolved        = pairing.Resolved
	PairingActionAlreadyResolved = pairing.AlreadyResolved
	PairingActionExpired         = pairing.Expired
)

func NewBroker(now func() time.Time) *Broker {
	return pairing.NewBroker[PairingMeta](pairing.Config{
		Timeout: pairingTimeout, Cooldown: pairingCooldown, MaxQueue: maxQueueLen, Now: now,
	})
}
