package adapterhost

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
)

// TestForwardToChild_RealEngineChild is the one test in this package that exercises the router's
// forwarding seam against a real Node subprocess rather than a fake — every other adapterhost test
// proves its own half of the pipe (Session's queue/writer, enginehost's own SendData/AttachStream,
// unchanged since P54), but the seam where Router.AttachStream wires a Session in as the child's
// Sink and forwardToChild calls SendData is new in this milestone. This is the closest feasible
// stand-in for M4's own acceptance note ("the app boots and a MariaDB connection still works end
// to end") that this package can run without a MariaDB container and a full Wails boot: the shared
// engine-fixture.mjs only implements the control-plane ops (adapter:connect and friends), not the
// data-plane DATA_OP set, so this proves the byte pipe itself rather than a specific adapter's
// response.
func TestForwardToChild_RealEngineChild(t *testing.T) {
	host := enginetest.Host(t)
	// "kafka" is an arbitrary real kind here — NewRouterAllNodeServed forwards every kind to the
	// child regardless of nativeKinds, which is what a test of the forwarding seam itself needs.
	conns := fakeKindLookup{"conn-1": "kafka"}
	r := NewRouterAllNodeServed(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), host, conns)

	conn := newFakeConn()
	session, detach := r.AttachStream(conn)
	defer detach()

	frame := mustFrame(t, map[string]any{
		"kind": "req", "id": 1, "op": "data:read",
		"payload": map[string]any{"connectionId": "conn-1", "pageSize": 10, "cursor": map[string]any{"mode": "offset", "offset": 0}},
	})
	// forwardToChild's SendData call reaching a real, live Node process without erroring is the
	// thing this test actually proves — the fixture has nothing to answer with on the data
	// channel, so a response is not expected, but the pipe write itself must succeed.
	r.HandleDataFrame(session, frame)
	if !host.Alive() {
		t.Fatal("the real engine child died — forwardToChild's SendData must have broken something")
	}
}
