package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
)

// GitStreamName is §3's second named Wails stream, "git" — Option C over reusing bridge.StreamName
// (§1.3 establishes HandleStream is a map insert; a second name costs nothing and needs no change
// to the first) or building Git's stream on Wails' broadcast Events (rejected: no backpressure,
// and @kira/git-ipc's stream contract is explicitly credit-based).
const GitStreamName = "git"

// This file is the server half of @kira/git-ipc's frame protocol (packages/git-ipc/src/rpc.ts) —
// req/res/evt/open/chunk/end/credit/cancel, wrapped in validate.ts's versioned envelope. Nothing
// here is a second implementation of that protocol's semantics so much as a Go transcription of
// createRpcServer's own state machine, kept field-for-field faithful (the frame union, the
// delete-before-respond race guard against a request racing its own cancellation, the
// aborted-vs-real-error split on a stream's own 'end') so this file's correctness is checkable by
// reading rpc.ts beside it, not by re-deriving the protocol from scratch.

// gitContractVersion mirrors GitContractVersion (git.go) — kept as its own local alias so this
// file reads self-contained against rpc.ts/validate.ts without a cross-file jump for the one
// number every envelope carries.
const gitContractVersion = GitContractVersion

// gitWireError mirrors @kira/git-ipc's WireError (rpc.ts): code and message always, kind only for
// a classified error that carries one (P1 produces none yet — gitclient.Error's own Kind is not
// surfaced onto the wire until a caller needs it; mapGitError already folds it into ipcerr's plain
// code/message).
type gitWireError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Kind    string `json:"kind,omitempty"`
}

// gitFrame is every member of rpc.ts's Frame union folded into one struct — a field not
// meaningful for a given T is simply absent (omitempty on encode, ignored on decode). The union
// is small and every variant's fields are primitives-or-raw-JSON, so one struct with a `t`
// discriminant reads clearer here than eight Go types behind an interface would.
type gitFrame struct {
	T       string          `json:"t"`
	ID      int             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *gitWireError   `json:"error,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Seq     int             `json:"seq,omitempty"`
	Chunk   json.RawMessage `json:"chunk,omitempty"`
	N       int             `json:"n,omitempty"`
}

type gitEnvelope struct {
	Version int      `json:"version"`
	Body    gitFrame `json:"body"`
}

func boolPtr(b bool) *bool { return &b }

// toGitWireError maps a Go error into the wire shape — *ipcerr.Error (what every GitService
// method already returns on failure) carries its Code/Message straight across; anything else
// (a Go-side panic recovery is out of scope, but a defensive default costs nothing) folds to
// E_INTERNAL, mirroring bridge/git.go's own mapGitError default arm.
func toGitWireError(err error) *gitWireError {
	var ierr *ipcerr.Error
	if errors.As(err, &ierr) {
		return &gitWireError{Code: ierr.Code, Message: ierr.Message}
	}
	return &gitWireError{Code: "E_INTERNAL", Message: err.Error()}
}

// gitRequestHandler adapts one GitService method to the request dispatch table — params arrive as
// raw JSON (already-unmarshalled by json.Unmarshal into whichever concrete Args type the method
// needs), result returned as `any` for the caller to re-marshal onto the wire.
type gitRequestHandler func(ctx context.Context, svc *GitService, params json.RawMessage) (any, error)

// gitRequestHandlers is the complete request-key table — REQUEST_KEYS in validate.ts, restated in
// Go rather than imported (TypeScript is not importable here); tests/unit/wireConformance-shaped
// drift between the two is what a later phase's own parity test (mirroring
// go-ts-vocabulary-parity.spec.ts's existing precedent for tab kinds) would catch, not attempted
// here since P1 adds no new phase-spanning vocabulary of that kind.
var gitRequestHandlers = map[string]gitRequestHandler{
	"app.init": func(ctx context.Context, svc *GitService, _ json.RawMessage) (any, error) {
		return svc.Init(ctx)
	},
	"repo.list": func(_ context.Context, svc *GitService, _ json.RawMessage) (any, error) {
		return svc.ListRepos()
	},
	"repo.pick": func(_ context.Context, svc *GitService, _ json.RawMessage) (any, error) {
		return svc.PickRepo()
	},
	"repo.open": func(ctx context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitRepoOpenArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.OpenRepo(ctx, args)
	},
	"repo.close": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitRepoCloseArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.CloseRepo(args)
	},
	"graph.status": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitGraphStatusArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.GraphStatus(args)
	},
	"graph.loadMore": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitGraphLoadMoreArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.GraphLoadMore(args)
	},
	"graph.refresh": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitGraphRefreshArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.GraphRefresh(args)
	},
}

// creditGate is rpc.ts's own CreditGate class, transcribed: a small counting semaphore an open
// stream's emit loop waits on before pushing its next chunk. P1's one stream handler
// (graph.stream) never actually calls acquire — it has no commits to walk yet (§0.2) — but the
// mechanism is written now, correctly, rather than stubbed, since P2 is the first real consumer
// and this is the one place its backpressure has to be exactly right.
type creditGate struct {
	mu        sync.Mutex
	available int
	waiters   []chan struct{}
}

func newCreditGate() *creditGate { return &creditGate{} }

func (g *creditGate) grant(n int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.available += n
	for g.available > 0 && len(g.waiters) > 0 {
		g.available--
		w := g.waiters[0]
		g.waiters = g.waiters[1:]
		close(w)
	}
}

// acquire blocks until a credit is available or ctx is done — the latter is how a cancelled
// stream's own emit loop unblocks rather than hanging forever on a consumer that stopped granting.
func (g *creditGate) acquire(ctx context.Context) error {
	g.mu.Lock()
	if g.available > 0 {
		g.available--
		g.mu.Unlock()
		return nil
	}
	ch := make(chan struct{})
	g.waiters = append(g.waiters, ch)
	g.mu.Unlock()
	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// gitStreamSession is one renderer connection's whole server-side state: the one writer goroutine
// every frame goes through (StreamConn.Send is not documented safe for concurrent callers, and
// this session dispatches each inbound req/open onto its own goroutine — bridge/stream.go's own
// engine-stream precedent, "router gives this session its own single writer", is the same
// discipline applied here), plus the active-work/credit-gate bookkeeping every cancel/credit frame
// needs to reach.
type gitStreamSession struct {
	svc  *GitService
	conn StreamSession

	sendCh chan []byte
	done   chan struct{}
	stop   sync.Once

	mu          sync.Mutex
	activeWork  map[int]context.CancelFunc
	creditGates map[int]*creditGate
}

func newGitStreamSession(svc *GitService, conn StreamSession) *gitStreamSession {
	s := &gitStreamSession{
		svc:         svc,
		conn:        conn,
		sendCh:      make(chan []byte, 16),
		done:        make(chan struct{}),
		activeWork:  make(map[int]context.CancelFunc),
		creditGates: make(map[int]*creditGate),
	}
	go s.writeLoop()
	return s
}

func (s *gitStreamSession) writeLoop() {
	for {
		select {
		case b := <-s.sendCh:
			_ = s.conn.Send(b) // a write failure means the connection is going away; the
			// receive loop in ServeGitStream will observe that on its own next Receive and tear
			// this session down — nothing more to do about one lost frame here.
		case <-s.done:
			return
		}
	}
}

func (s *gitStreamSession) send(frame gitFrame) {
	b, err := json.Marshal(gitEnvelope{Version: gitContractVersion, Body: frame})
	if err != nil {
		return // every gitFrame value this file ever constructs is JSON-safe by construction.
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
func (s *gitStreamSession) Emit(method string, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	s.send(gitFrame{T: "evt", Method: method, Payload: b})
}

// removeActiveWork deletes id from activeWork and reports whether it was actually present —
// mirrors rpc.ts's own `if (activeWork.delete(id))` idiom: a completion that loses the race
// against an incoming 'cancel' frame (which deletes the same entry first) must send nothing, since
// the client already resolved locally the moment it sent 'cancel' and is not waiting on a reply.
func (s *gitStreamSession) removeActiveWork(id int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.activeWork[id]; !ok {
		return false
	}
	delete(s.activeWork, id)
	return true
}

func (s *gitStreamSession) handleRequest(id int, method string, params json.RawMessage) {
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.activeWork[id] = cancel
	s.mu.Unlock()

	var result any
	var err error
	if handler, ok := gitRequestHandlers[method]; ok {
		result, err = handler(ctx, s.svc, params)
	} else {
		err = ipcerr.BadRequest("unknown request method: " + method)
	}
	cancel()

	if !s.removeActiveWork(id) {
		return
	}
	if err != nil {
		s.send(gitFrame{T: "res", ID: id, OK: boolPtr(false), Error: toGitWireError(err)})
		return
	}
	resultBytes, merr := json.Marshal(result)
	if merr != nil {
		s.send(gitFrame{T: "res", ID: id, OK: boolPtr(false), Error: &gitWireError{Code: "E_INTERNAL", Message: merr.Error()}})
		return
	}
	s.send(gitFrame{T: "res", ID: id, OK: boolPtr(true), Result: resultBytes})
}

// gitGraphStreamParams is graph.stream's own params shape — a local, minimal decode (only what
// this handler actually reads) rather than importing a wire type from gitclient, since nothing in
// gitclient needs to know its own capability is reachable over a stream.
type gitGraphStreamParams struct {
	RepoID string `json:"repoId"`
}

func (s *gitStreamSession) handleOpen(id int, method string, params json.RawMessage) {
	// P1's own stream handler (graph.stream) does no asynchronous work that would ever consult
	// ctx.Done() — it resolves synchronously below — so only cancel is kept; P2, the first stream
	// handler with a real emit loop to cancel, is what starts reading ctx itself.
	_, cancel := context.WithCancel(context.Background())
	gate := newCreditGate()
	s.mu.Lock()
	s.activeWork[id] = cancel
	s.creditGates[id] = gate
	s.mu.Unlock()

	var streamErr error
	switch method {
	case "graph.stream":
		var args gitGraphStreamParams
		if uerr := json.Unmarshal(params, &args); uerr != nil {
			streamErr = ipcerr.BadRequest("invalid params: " + uerr.Error())
		} else if args.RepoID == "" {
			streamErr = ipcerr.BadRequest("repoId is required")
		} else if _, ok := s.svc.Client.Registry.Get(args.RepoID); !ok {
			streamErr = ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
		}
		// A valid open has nothing to walk yet (§0.2: no porcelain parser, no paged `git log` —
		// P2's own row) — it falls straight through to a clean 'end' below with zero chunks
		// emitted, which is what tells graphView's own store "0 rows, exhausted" rather than
		// leaving it waiting on a chunk that will never come.
	default:
		streamErr = ipcerr.BadRequest("unknown stream method: " + method)
	}

	cancel()
	s.mu.Lock()
	delete(s.creditGates, id)
	s.mu.Unlock()

	if !s.removeActiveWork(id) {
		return
	}
	if streamErr != nil {
		s.send(gitFrame{T: "end", ID: id, Error: toGitWireError(streamErr)})
		return
	}
	s.send(gitFrame{T: "end", ID: id})
}

func (s *gitStreamSession) handleCredit(id, n int) {
	s.mu.Lock()
	gate := s.creditGates[id]
	s.mu.Unlock()
	if gate != nil {
		gate.grant(n)
	}
}

func (s *gitStreamSession) handleCancel(id int) {
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

func (s *gitStreamSession) handleRaw(raw []byte) {
	var env gitEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return // a corrupt or truncated frame has no reliably extractable id — dropped, the same
		// move port.ts's own onmessage handler makes on an undecodable frame.
	}
	if env.Version != gitContractVersion {
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

func (s *gitStreamSession) close() {
	s.mu.Lock()
	for _, cancel := range s.activeWork {
		cancel()
	}
	s.activeWork = make(map[int]context.CancelFunc)
	s.creditGates = make(map[int]*creditGate)
	s.mu.Unlock()
	s.stop.Do(func() { close(s.done) })
}

// ServeGitStream runs for the life of one connection — C5's own protocol code, isolated from
// shell.RegisterGitStream's wiring so it is reviewable as protocol rather than buried in it (§5's
// own reasoning for splitting C5 from C4).
func ServeGitStream(svc *GitService, conn StreamSession) {
	s := newGitStreamSession(svc, conn)
	defer s.close()
	for {
		raw, err := conn.Receive()
		if err != nil {
			return
		}
		s.handleRaw(raw)
	}
}
