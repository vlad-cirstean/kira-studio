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

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
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
	// Stream serves one `open`ed stream, calling emit for each chunk it produces. emit acquires a
	// credit before it does anything else (the transcription of rpc.ts's own emit — the credit
	// gate's first real caller, G1 §11/G3 D5), encodes payload as the chunk's own JSON body, and
	// queues it with blob (nil for a JSON-only chunk) as D4's own out-of-band bytes. An oversize
	// encoded body is refused with an error rather than silently dropped (F21/D5) — the caller
	// should let that error end the stream with a real `end` frame, not swallow it.
	Stream func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error
	// MaxFrameBytes caps how large one encoded frame body (JSON header plus blob) may be before
	// emit refuses it — set by gitsock from its own frame cap. Zero means unbounded, which is what
	// session_test.go's existing fixtures get.
	MaxFrameBytes int
}

// Session is one connection's whole server-side state: the one writer goroutine every frame goes
// through (Conn.Send is not documented safe for concurrent callers, and a session dispatches each
// inbound req/open onto its own goroutine — bridge/stream.go's own engine-stream precedent,
// "router gives this session its own single writer", is the same discipline applied here), plus
// the active-work/credit-gate bookkeeping every cancel/credit frame needs to reach, and Emit — the
// production handle gitsession's subscriber fan-out (G2 plan D17) calls to deliver repo.changed.
type Session struct {
	h    Handlers
	conn Conn

	sendCh chan []byte
	done   chan struct{}
	stop   sync.Once

	mu          sync.Mutex
	activeWork  map[int]context.CancelFunc
	creditGates map[int]*creditGate
}

// NewSession constructs a Session over conn — Serve (below) is what actually runs it; a caller
// that only needs the handle to Emit from elsewhere while Serve loops in its own goroutine is
// exactly gitsock's own use (D19).
func NewSession(conn Conn, h Handlers) *Session {
	s := &Session{
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

func (s *Session) writeLoop() {
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

func (s *Session) send(f frame) {
	b, err := encodeBody(envelope{Version: s.h.ContractVersion, Body: f}, nil)
	if err != nil {
		return // every frame value this package ever constructs is JSON-safe by construction.
	}
	select {
	case s.sendCh <- b:
	case <-s.done:
	}
}

// sendChunk encodes f with blob as D4's own out-of-band-blob body (or a plain JSON one, when blob
// is nil) and queues it — refusing (rather than silently truncating, F21) a body that would
// exceed h.MaxFrameBytes.
func (s *Session) sendChunk(f frame, blob []byte) error {
	b, err := encodeBody(envelope{Version: s.h.ContractVersion, Body: f}, blob)
	if err != nil {
		return err
	}
	if s.h.MaxFrameBytes > 0 && len(b) > s.h.MaxFrameBytes {
		return ipcerr.New("E_FRAME_TOO_LARGE", "rpcstream: encoded chunk exceeds the frame size cap")
	}
	select {
	case s.sendCh <- b:
	case <-s.done:
	}
	return nil
}

// sendResult queues a successful 'res' frame — the response path's own twin of sendChunk's guard
// (D2a/F8): an oversize encoded body is refused with an error res carrying E_FRAME_TOO_LARGE
// instead of being silently dropped by writeFrame further down (gitsock/frame.go), which would
// otherwise leave the client waiting on a response that never arrives, forever. Only the success
// path needs the check — an error res is always small (a code plus a message).
func (s *Session) sendResult(id int, resultBytes json.RawMessage) {
	f := frame{T: "res", ID: id, OK: boolPtr(true), Result: resultBytes}
	b, err := encodeBody(envelope{Version: s.h.ContractVersion, Body: f}, nil)
	if err != nil {
		return // every frame value this package ever constructs is JSON-safe by construction.
	}
	if s.h.MaxFrameBytes > 0 && len(b) > s.h.MaxFrameBytes {
		s.send(frame{T: "res", ID: id, OK: boolPtr(false), Error: &wireError{
			Code: "E_FRAME_TOO_LARGE", Message: "rpcstream: encoded response exceeds the frame size cap",
		}})
		return
	}
	select {
	case s.sendCh <- b:
	case <-s.done:
	}
}

// Emit sends an 'evt' frame — the Go half of rpc.ts's RpcServer.emit. Its production caller is
// gitsession's subscriber fan-out (G2 plan D14/D17), reached through gitsock's Conn.Emit closure
// (D19); session_test.go's own TestSession_Emit_EventCrosses is what first proved the wire shape.
func (s *Session) Emit(method string, payload any) {
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
func (s *Session) removeActiveWork(id int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.activeWork[id]; !ok {
		return false
	}
	delete(s.activeWork, id)
	return true
}

func (s *Session) handleRequest(id int, method string, params json.RawMessage) {
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
	s.sendResult(id, resultBytes)
}

// handleOpen runs one stream's handler. ctx/gate are registered by handleRaw synchronously,
// before this is ever dispatched onto its own goroutine — a client that sends 'credit'
// immediately after 'open' (every real client does, rpc.ts's own stream() posts both back to
// back) must always find the gate already there; registering it from inside this goroutine would
// race the very next frame handleRaw's own receive loop processes.
func (s *Session) handleOpen(ctx context.Context, cancel context.CancelFunc, gate *creditGate, id int, method string, params json.RawMessage) {
	seq := 0
	emit := func(payload any, blob []byte) error {
		if err := gate.acquire(ctx); err != nil {
			return err
		}
		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if err := s.sendChunk(frame{T: "chunk", ID: id, Seq: seq, Chunk: payloadJSON}, blob); err != nil {
			return err
		}
		seq++
		return nil
	}

	streamErr := s.h.Stream(ctx, method, params, emit)

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

func (s *Session) handleCredit(id, n int) {
	s.mu.Lock()
	gate := s.creditGates[id]
	s.mu.Unlock()
	if gate != nil {
		gate.grant(n)
	}
}

func (s *Session) handleCancel(id int) {
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

func (s *Session) handleRaw(raw []byte) {
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
		ctx, cancel := context.WithCancel(context.Background())
		gate := newCreditGate()
		s.mu.Lock()
		s.activeWork[env.Body.ID] = cancel
		s.creditGates[env.Body.ID] = gate
		s.mu.Unlock()
		go s.handleOpen(ctx, cancel, gate, env.Body.ID, env.Body.Method, env.Body.Params)
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

func (s *Session) close() {
	s.mu.Lock()
	for _, cancel := range s.activeWork {
		cancel()
	}
	s.activeWork = make(map[int]context.CancelFunc)
	s.creditGates = make(map[int]*creditGate)
	s.mu.Unlock()
	s.stop.Do(func() { close(s.done) })
}

// Serve runs for the life of one connection and returns when the peer's side closes, closing the
// session on return. Call NewSession first and keep the handle to Emit from elsewhere (gitsock
// does exactly this, D19) — Serve itself takes no arguments precisely so there is one Session, not
// a second copy constructed internally that Emit could never reach.
func (s *Session) Serve() {
	defer s.close()
	for {
		raw, err := s.conn.Receive()
		if err != nil {
			return
		}
		s.handleRaw(raw)
	}
}
