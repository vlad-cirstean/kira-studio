package flowharness

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/flowtest"
)

// Event, Events, EnvComplete and Complete live in internal/flowtest, shared with Kira Studio's harness.
type (
	Event  = flowtest.Event
	Events = flowtest.Events
)

// EnvComplete turns on the complete flow suite.
const EnvComplete = flowtest.EnvComplete

// Complete skips a test unless the complete suite is on.
func Complete(t testing.TB) { flowtest.Complete(t) }

func newEvents() *Events { return flowtest.NewEvents() }
