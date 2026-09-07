// Package rpcstream is the protocol-generic half of a correlated-RPC-with-credits frame protocol
// carried over one connection — req/res/evt/open/chunk/end/credit/cancel, wrapped in a versioned
// envelope. It is a Go transcription of @kira/ipc-core's own createRpcServer state machine (the
// frame union, the delete-before-respond race guard against a request racing its own cancellation,
// the aborted-vs-real-error split on a stream's own 'end') kept field-for-field faithful, so this
// package's correctness is checkable by reading rpc.ts beside it, not by re-deriving the protocol
// from scratch. It never learns what a method means — that is entirely Handlers' job — which is
// what lets a second module (any future bound-service stream) reuse it without duplicating any of
// this file.
package rpcstream

import (
	"context"
	"encoding/json"
	"sync"
)

// Conn is the whole of what this protocol needs from one renderer connection. Declared here rather
// than imported so this package depends on nothing in bridge; bridge.StreamSession (and
// *application.StreamConn behind it) satisfies it structurally, the same way
// adapterhost.StreamSession and bridge.StreamSession already satisfy each other.
type Conn interface {
	Send(frame []byte) error
	Receive() ([]byte, error)
}

// Handlers is everything a module supplies to speak this protocol over its own vocabulary. The
// protocol never learns what a method means: it decodes, correlates, gates and encodes, and asks
// these two functions to do the rest.
type Handlers struct {
	ContractVersion int
	Request         func(ctx context.Context, method string, params json.RawMessage) (any, error)
	Stream          func(ctx context.Context, method string, params json.RawMessage) error
}

// session is one renderer connection's whole server-side state: the one writer goroutine every
// frame goes through (StreamConn.Send is not documented safe for concurrent callers, and this
// session dispatches each inbound req/open onto its own goroutine — bridge/stream.go's own
// engine-stream precedent, "router gives this session its own single writer", is the same
// discipline applied here), plus the active-work/credit-gate bookkeeping every cancel/credit frame
// needs to reach.
type session struct {
	h    Handlers
	conn Conn

	sendCh chan []byte
	done   chan struct{}
	stop   sync.Once

	mu          sync.Mutex
	activeWork  map[int]context.CancelFunc
	creditGates map[int]*creditGate
}

func newSession(conn Conn, h Handlers) *session {
	s := &session{
		h:           h,
		conn:        conn,
		sendCh:      make(chan []byte, 16),
		done:        make(chan struct{}),
		activeWork:  make(map[int]context.CancelFunc),
		creditGates: make(map[int]*creditGate),
	}
	go s.writeLoop()
	return s
}

func (s *session) writeLoop() {
	for {
		select {
		case b := <-s.sendCh:
			_ = s.conn.Send(b) // a write failure means the connection is going away; the
			// receive loop in Serve will observe that on its own next Receive and tear this
			// session down — nothing more to do about one lost frame here.
		case <-s.done:
			return
		}
	}
}

func (s *session) send(f frame) {
	b, err := json.Marshal(envelope{Version: s.h.ContractVersion, Body: f})
	if err != nil {
		return // every frame value this package ever constructs is JSON-safe by construction.
	}
	select {
	case s.sendCh <- b:
	case <-s.done:
	}
}

// Emit sends an 'evt' frame — the Go half of rpc.ts's RpcServer.emit, available to a future
// phase's Watcher-driven repo.changed/settings.changed. P1 wires no production caller of this yet
// (§0.2: watching-into-events is P2's own row); it exists, correctly, for gitstream_test.go to
// prove the event side of the frame protocol crosses at all — the "an event crossing" §7 exit
// criterion names, and the honest way to prove it without inventing a P2 feature early.
func (s *session) Emit(method string, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	s.send(frame{T: "evt", Method: method, Payload: b})
}

// removeActiveWork deletes id from activeWork and reports whether it was actually present —
// mirrors rpc.ts's own `if (activeWork.delete(id))` idiom: a completion that loses the race
// against an incoming 'cancel' frame (which deletes the same entry first) must send nothing, since
// the client already resolved locally the moment it sent 'cancel' and is not waiting on a reply.
func (s *session) removeActiveWork(id int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.activeWork[id]; !ok {
		return false
	}
	delete(s.activeWork, id)
	return true
}

func (s *session) handleRequest(id int, method string, params json.RawMessage) {
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.activeWork[id] = cancel
	s.mu.Unlock()

	result, err := s.h.Request(ctx, method, params)
	cancel()

	if !s.removeActiveWork(id) {
		return
	}
	if err != nil {
		s.send(frame{T: "res", ID: id, OK: boolPtr(false), Error: wireErrorFrom(err)})
		return
	}
	resultBytes, merr := json.Marshal(result)
	if merr != nil {
		s.send(frame{T: "res", ID: id, OK: boolPtr(false), Error: &wireError{Code: "E_INTERNAL", Message: merr.Error()}})
		return
	}
	s.send(frame{T: "res", ID: id, OK: boolPtr(true), Result: resultBytes})
}

func (s *session) handleOpen(id int, method string, params json.RawMessage) {
	ctx, cancel := context.WithCancel(context.Background())
	gate := newCreditGate()
	s.mu.Lock()
	s.activeWork[id] = cancel
	s.creditGates[id] = gate
	s.mu.Unlock()

	streamErr := s.h.Stream(ctx, method, params)

	cancel()
	s.mu.Lock()
	delete(s.creditGates, id)
	s.mu.Unlock()

	if !s.removeActiveWork(id) {
		return
	}
	if streamErr != nil {
		s.send(frame{T: "end", ID: id, Error: wireErrorFrom(streamErr)})
		return
	}
	s.send(frame{T: "end", ID: id})
}

func (s *session) handleCredit(id, n int) {
	s.mu.Lock()
	gate := s.creditGates[id]
	s.mu.Unlock()
	if gate != nil {
		gate.grant(n)
	}
}

func (s *session) handleCancel(id int) {
	s.mu.Lock()
	cancel, ok := s.activeWork[id]
	if ok {
		delete(s.activeWork, id)
		delete(s.creditGates, id)
	}
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

func (s *session) handleRaw(raw []byte) {
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return // a corrupt or truncated frame has no reliably extractable id — dropped, the same
		// move port.ts's own onmessage handler makes on an undecodable frame.
	}
	if env.Version != s.h.ContractVersion {
		return // a stale build talking to a fresh one (validate.ts's own guard) — nothing to
		// answer meaningfully; the renderer's own decode already refuses this in the other
		// direction.
	}
	switch env.Body.T {
	case "req":
		go s.handleRequest(env.Body.ID, env.Body.Method, env.Body.Params)
	case "open":
		go s.handleOpen(env.Body.ID, env.Body.Method, env.Body.Params)
	case "credit":
		s.handleCredit(env.Body.ID, env.Body.N)
	case "cancel":
		s.handleCancel(env.Body.ID)
	default:
		// "res"/"evt"/"chunk"/"end" are server -> client only; a stray one from the renderer is
		// dropped rather than failing loudly (unlike rpc.ts's own throw) — a misbehaving renderer
		// must never be able to take this session down.
	}
}

func (s *session) close() {
	s.mu.Lock()
	for _, cancel := range s.activeWork {
		cancel()
	}
	s.activeWork = make(map[int]context.CancelFunc)
	s.creditGates = make(map[int]*creditGate)
	s.mu.Unlock()
	s.stop.Do(func() { close(s.done) })
}

// Serve runs for the life of one connection and returns when the peer's side closes.
func Serve(conn Conn, h Handlers) {
	s := newSession(conn, h)
	defer s.close()
	for {
		raw, err := conn.Receive()
		if err != nil {
			return
		}
		s.handleRaw(raw)
	}
}
