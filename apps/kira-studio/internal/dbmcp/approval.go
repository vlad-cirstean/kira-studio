package dbmcp

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
)

// ApprovalTimeout is the app's own existing prompt bound (gitsock's pairingTimeout,
// gitaskpass.DefaultTimeout), twice over — a prompt-mode query waits this long for a human answer
// before giving up.
const ApprovalTimeout = 120 * time.Second

// maxPendingApprovals is gitsock.Broker's own queue cap, for the same reason: an MCP client is a
// program and can call in a loop, and nothing else bounds how many run_query calls can be
// in-flight at once.
const maxPendingApprovals = 50

// ApprovalOutcome is ApprovalBroker.Request's own vocabulary — never a Go error (gitsock's own
// PairingOutcome precedent: a human decision is a value, not a failure).
type ApprovalOutcome int

const (
	ApprovalApproved ApprovalOutcome = iota
	ApprovalDenied
	ApprovalTimedOut
	ApprovalAbandoned // the server stopped, or the MCP client went away (ctx cancelled)
)

// ApprovalActionResult is what Approve/Deny report — also never an error.
type ApprovalActionResult int

const (
	ApprovalActionResolved ApprovalActionResult = iota
	ApprovalActionAlreadyResolved
)

// ApprovalReason is why this request was raised — M2's permission gate, or M3's heavy-plan flag.
// Both are the same question ("should this run?") asked for different reasons, so they share one
// queue and one dialog rather than competing for the user's attention (M3 §6.2).
type ApprovalReason string

const (
	ApprovalReasonPermission ApprovalReason = "permission"
	ApprovalReasonHeavy      ApprovalReason = "heavy"
)

// ApprovalPlanIssue is one Issue as the dialog renders it — plan evidence, never the whole tree.
type ApprovalPlanIssue struct {
	Severity string
	Code     string
	Message  string
}

// ApprovalPlan is the plan evidence the dialog shows for a heavy-query (or plan-carrying
// permission) request — never the whole tree (M3 §6.2). Issues is capped by the caller
// (bridge/dbmcp.go's own wire projection), with IssuesOmitted carrying the remainder.
type ApprovalPlan struct {
	EstimatedRowsRead *float64
	ThresholdRows     int
	OverThreshold     bool
	Issues            []ApprovalPlanIssue
	IssuesOmitted     int
}

// ApprovalRequest is one queued query — what the dialog renders. RequestID, EnqueuedAt and
// ExpiresAt are minted by Request, never by the caller.
type ApprovalRequest struct {
	RequestID      string
	ConnectionID   string
	ConnectionName string
	Kind           string
	Class          adapters.OpClass
	Statement      string
	EnqueuedAt     time.Time
	ExpiresAt      time.Time
	// Reason is M2's own "permission" for every M2-era call site — M3's runQuery/explainQuery are
	// the first callers to pass ApprovalReasonHeavy or a non-nil Plan.
	Reason ApprovalReason
	// Plan is the heavy-query evidence (M3 §6.1/§6.2), nil for an ordinary permission prompt with
	// no plan attached (auto-force-explain off, or the statement was not explainable).
	Plan *ApprovalPlan
}

// ApprovalSnapshot is emitted on every queue change: the head request (nil when empty) plus how
// many are waiting behind it.
type ApprovalSnapshot struct {
	Pending *ApprovalRequest
	Queued  int
}

type approvalEntry struct {
	req    ApprovalRequest
	result chan ApprovalOutcome // buffered 1; exactly one send over the entry's lifetime.
}

// ApprovalBroker implements M2 §5.1's queue/deadline/injected-clock state machine — gitsock.Broker
// (G1's pairing prompt)'s own shape: a FIFO of pending requests (at most one "presented", always
// the head) and a notify.Emitter[ApprovalSnapshot] fanning out every change. The one deliberate
// difference: Request selects on the MCP request's own ctx as well as its deadline, so a
// disconnected client stops the query without any external expiry ticker.
type ApprovalBroker struct {
	now func() time.Time

	mu    sync.Mutex
	queue []*approvalEntry
	byID  map[string]*approvalEntry

	emitter notify.Emitter[ApprovalSnapshot]
}

func NewApprovalBroker(now func() time.Time) *ApprovalBroker {
	return &ApprovalBroker{now: now, byID: map[string]*approvalEntry{}}
}

func (b *ApprovalBroker) OnApprovalChange(fn func(ApprovalSnapshot)) (unsubscribe func()) {
	return b.emitter.Subscribe(fn)
}

// Pending is the snapshot a newly opened window fetches on mount.
func (b *ApprovalBroker) Pending() ApprovalSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.snapshotLocked()
}

func (b *ApprovalBroker) snapshotLocked() ApprovalSnapshot {
	if len(b.queue) == 0 {
		return ApprovalSnapshot{}
	}
	head := b.queue[0].req
	return ApprovalSnapshot{Pending: &head, Queued: len(b.queue)}
}

// Request enqueues req (minting its RequestID, EnqueuedAt and ExpiresAt) and blocks the calling
// goroutine until it is approved, denied, its deadline elapses, or ctx is done — whichever comes
// first. Past maxPendingApprovals it returns ApprovalDenied immediately rather than queueing.
func (b *ApprovalBroker) Request(ctx context.Context, req ApprovalRequest) ApprovalOutcome {
	b.mu.Lock()
	if len(b.queue) >= maxPendingApprovals {
		b.mu.Unlock()
		return ApprovalDenied
	}
	now := b.now()
	req.RequestID = uuid.NewString()
	req.EnqueuedAt = now
	req.ExpiresAt = now.Add(ApprovalTimeout)
	entry := &approvalEntry{req: req, result: make(chan ApprovalOutcome, 1)}
	b.queue = append(b.queue, entry)
	b.byID[entry.req.RequestID] = entry
	snap := b.snapshotLocked()
	b.mu.Unlock()

	// Every enqueue emits (gitsock's G31 round-2 finding #6): a second/third request queueing
	// behind an already-presented head still changes Queued, and any subscriber's "N waiting" line
	// must track that even though the presented head is unchanged.
	b.emitter.Emit(snap)

	timer := time.NewTimer(time.Until(entry.req.ExpiresAt))
	defer timer.Stop()
	select {
	case outcome := <-entry.result:
		return outcome
	case <-timer.C:
		if b.resolve(entry.req.RequestID, ApprovalTimedOut) == ApprovalActionResolved {
			return ApprovalTimedOut
		}
		// Approve/Deny won the race in the instant between the timer firing and this goroutine
		// taking b.mu — take their answer instead of overriding it.
		return <-entry.result
	case <-ctx.Done():
		if b.resolve(entry.req.RequestID, ApprovalAbandoned) == ApprovalActionResolved {
			return ApprovalAbandoned
		}
		return <-entry.result
	}
}

// Approve resolves requestID as approved. Deny resolves it as denied. Both report
// ApprovalActionAlreadyResolved, never an error, for an unknown or already-resolved id —
// whichever window (or Request's own deadline/ctx branch) got there first wins, the other is a
// no-op.
func (b *ApprovalBroker) Approve(requestID string) ApprovalActionResult {
	return b.resolve(requestID, ApprovalApproved)
}

func (b *ApprovalBroker) Deny(requestID string) ApprovalActionResult {
	return b.resolve(requestID, ApprovalDenied)
}

// resolve is Approve/Deny's shared body, also called from Request's own deadline/ctx branches so
// every resolution path — human decision, timeout, abandonment — goes through the same
// remove-then-send sequence and can never double-send on entry.result.
func (b *ApprovalBroker) resolve(requestID string, outcome ApprovalOutcome) ApprovalActionResult {
	b.mu.Lock()
	entry, ok := b.byID[requestID]
	if !ok {
		b.mu.Unlock()
		return ApprovalActionAlreadyResolved
	}
	b.removeLocked(entry)
	snap := b.snapshotLocked()
	b.mu.Unlock()

	entry.result <- outcome
	b.emitter.Emit(snap)
	return ApprovalActionResolved
}

// AbandonAll resolves every pending entry as ApprovalAbandoned and empties the queue, leaving the
// broker usable: the DB MCP server can be toggled off and on again within one app run. Called on
// server stop and app quit so no run_query call is ever left blocked on a broker nobody will
// answer again.
func (b *ApprovalBroker) AbandonAll() {
	b.mu.Lock()
	entries := b.queue
	b.queue = nil
	b.byID = map[string]*approvalEntry{}
	snap := b.snapshotLocked()
	b.mu.Unlock()

	for _, entry := range entries {
		entry.result <- ApprovalAbandoned
	}
	if len(entries) > 0 {
		b.emitter.Emit(snap)
	}
}

// removeLocked drops entry from both byID and the queue slice. Caller holds b.mu.
func (b *ApprovalBroker) removeLocked(entry *approvalEntry) {
	delete(b.byID, entry.req.RequestID)
	for i, e := range b.queue {
		if e == entry {
			b.queue = append(b.queue[:i], b.queue[i+1:]...)
			break
		}
	}
}
