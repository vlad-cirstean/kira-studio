// Package connections is the Go analogue of src/main/connections.ts: the full connection
// lifecycle service — CRUD, the in-memory connection-state map, connect/disconnect wired to
// internal/preconnect and internal/adapterhost, and the in-flight-connect dedupe.
package connections

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	idgen "github.com/kirathecat/kira-studio/shell/internal/id"
	"github.com/kirathecat/kira-studio/shell/internal/notify"
	"github.com/kirathecat/kira-studio/shell/internal/preconnect"
	"github.com/kirathecat/kira-studio/shell/internal/secrets"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// Backend is the slice of adapter lifecycle operations this service calls through instead of
// straight into internal/adapterhost (A11's per-consumer-interface discipline — the same shape as
// tree.Backend and bridge.Canceller). *adapterhost.Router satisfies this structurally; a two-line
// fake can too, which is what keeps this package's own tests simple. Three methods: Test and
// Connect each need their own method (they resolve config differently and return different
// shapes), and Disconnect covers all three fire-and-forget call sites (onPreconnectExit, Remove,
// Disconnect).
type Backend interface {
	// Connect resolves cfg.Kind to a live adapter and returns what the caller needs to build the
	// connected state.
	Connect(ctx context.Context, cfg model.ResolvedConnectionConfig) (ConnectResult, error)
	// Test probes cfg without ever registering a live adapter — control.ts's handleTest:
	// connect, read the server version, unconditionally disconnect. A real Go error, not a
	// never-throws contract; Test (below) is what wraps it into TestResult.
	Test(ctx context.Context, cfg model.ResolvedConnectionConfig) (serverVersion string, err error)
	// Disconnect is fire-and-forget at every call site today, so it stays that shape here.
	Disconnect(ctx context.Context, connectionID string) error
}

// ConnectResult is engine-ops.ts's adapter:connect success payload, the part attemptConnect
// actually reads (serverVersion, caps) — Caps stays untyped because both a native adapter's
// adapters.Caps and a Node-forwarded connection's raw decoded JSON land here.
type ConnectResult struct {
	ServerVersion string
	Caps          any
}

// TestResult mirrors connections.ts's ConnectionTestResult — the shape Service.Test builds from
// Backend.Test's (serverVersion, error) return, matching the JSON the renderer already expects.
type TestResult struct {
	OK            bool    `json:"ok"`
	ServerVersion *string `json:"serverVersion,omitempty"`
	Error         *string `json:"error,omitempty"`
}

// RevealResult mirrors reveal()'s never-throws contract (P25 D9).
type RevealResult struct {
	Password *string `json:"password"`
	Error    *string `json:"error"`
}

// Deps is everything the service needs from the rest of the app.
type Deps struct {
	Conns      *repos.ConnectionsRepo
	Secrets    *repos.SecretsRepo
	Metadata   *repos.MetadataCacheRepo
	Cipher     *secrets.Cipher
	Backend    Backend
	Preconnect *preconnect.Supervisor
}

// attempt is one in-flight Connect(id) call, shared by every caller that asks for the same id
// while it is running (D11: at most one in-flight connect per connection).
type attempt struct {
	done  chan struct{}
	state model.ConnectionState
	err   error
}

// Service is the Go analogue of connections.ts's ConnectionsService.
type Service struct {
	deps Deps

	mu       sync.Mutex
	states   map[string]model.ConnectionState
	inFlight map[string]*attempt

	stateChanged        notify.Emitter[model.ConnectionState]
	metadataInvalidated notify.Emitter[string]
	listChanged         notify.Emitter[[]model.ConnectionSummary]
}

func New(d Deps) *Service {
	return &Service{
		deps:     d,
		states:   make(map[string]model.ConnectionState),
		inFlight: make(map[string]*attempt),
	}
}

// Start wires the preconnect exit handler (D14: split from New so main.go controls wiring order
// and every test can attach its own listener before the first event).
func (s *Service) Start() {
	s.deps.Preconnect.OnExit(s.onPreconnectExit)
}

// Shutdown kills every live pre-connect process. Called from main's before-quit.
func (s *Service) Shutdown() {
	s.deps.Preconnect.StopAll()
}

// onPreconnectExit is preconnect.ts:154-168's port: any exit while armed means the connection can
// no longer reach its target — best-effort disconnect the adapter and surface why.
func (s *Service) onPreconnectExit(exit preconnect.Exit) {
	// D6: the best-effort adapter:disconnect runs on its own goroutine, exactly as
	// connections.ts:155's `void … .catch(() => {})` does — this handler must not block the
	// shared preconnect exit-emitter goroutine for however long that disconnect takes.
	go func() {
		_ = s.deps.Backend.Disconnect(context.Background(), exit.ConnectionID)
	}()

	detail := "(exit unknown)"
	if exit.Code != nil {
		detail = fmt.Sprintf("(exit %d)", *exit.Code)
	}
	if exit.Signal != "" {
		detail = fmt.Sprintf("(signal %s)", exit.Signal)
	}
	tail := ""
	if exit.LastStderr != nil && *exit.LastStderr != "" {
		tail = ": " + *exit.LastStderr
	}
	msg := fmt.Sprintf("Pre-connect script exited %s%s — connection dropped.", detail, tail)
	s.emitState(model.ConnectionState{ConnectionID: exit.ConnectionID, Status: "error", Error: &msg, Since: nowMillis()})
}

func nowMillis() int64 { return time.Now().UnixMilli() }

// errorMessage extracts the human message a *ipcerr.Error (or any other error) carries, for the
// state/result string fields that surface a failure's text rather than propagate a Go error —
// the Go analogue of `err instanceof Error ? err.message : String(err)`.
func errorMessage(err error) string {
	var ie *ipcerr.Error
	if errors.As(err, &ie) {
		return ie.Message
	}
	return err.Error()
}

// wrapErr satisfies P55 §2 D5: every error crossing out of this package is an *ipcerr.Error. An
// error that already is one (or wraps one, e.g. repos/secrets' fmt.Errorf-wrapped E_SECRET_STORE)
// passes through with its original code and message; anything else becomes E_INTERNAL.
func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	var ie *ipcerr.Error
	if errors.As(err, &ie) {
		return ie
	}
	return ipcerr.Internal(err.Error())
}

func (s *Service) emitState(state model.ConnectionState) {
	s.mu.Lock()
	s.states[state.ConnectionID] = state
	s.mu.Unlock()
	s.stateChanged.Emit(state)
}

// emitListChanged broadcasts the authoritative list after any mutation — the renderer store
// otherwise only ever sees a connection created/changed through its own dialog wrappers, never
// one created via a direct call. Run synchronously (unlike connections.ts:96's `void
// emitListChanged()` fire-and-forget): a local list query never blocks long enough to need its
// own goroutine, and a synchronous broadcast is strictly easier to reason about, not a behaviour
// change a caller could observe. Failure is swallowed — a broadcast is best-effort and must not
// turn a successful mutation into a reported error.
func (s *Service) emitListChanged() {
	list, err := s.deps.Conns.List()
	if err != nil {
		return
	}
	s.listChanged.Emit(list)
}

func (s *Service) List() ([]model.ConnectionSummary, error) {
	list, err := s.deps.Conns.List()
	if err != nil {
		return nil, wrapErr(err)
	}
	return list, nil
}

func (s *Service) Create(in Input) (model.ConnectionSummary, error) {
	if err := in.Validate(); err != nil {
		return model.ConnectionSummary{}, err
	}

	// In fields mode `uri` is not authoritative — never store or return it, even if the draft
	// still carries a stale value (D9's guarantee that List never leaks a password must hold
	// regardless of what the caller sends).
	var uri *string
	if in.Mode == "uri" {
		uri = in.URI
	}
	password := in.Password
	if in.Mode == "uri" && uri != nil && *uri != "" {
		stripped, pw := stripURIPassword(*uri)
		uri = &stripped
		// P2 R2: only a password actually typed into the URI's own userinfo overrides whatever
		// the caller sent — a passwordless URI (the common case: D7 always strips one out before
		// ever showing it back to the user) says nothing about the password, so in.Password's own
		// three-state value (nil/""/replace) must stand, not be silently discarded in its favor.
		if pw != nil {
			password = pw
		}
	}

	// P25 D6: validate the secret can be encrypted before writing anything — a failure here
	// (cipher unavailable) leaves no row behind at all.
	if password != nil {
		if _, err := s.deps.Cipher.Encrypt(*password); err != nil {
			return model.ConnectionSummary{}, err
		}
	}

	fields := in.ConnectionFields
	fields.URI = uri
	id := idgen.New()
	created, err := s.deps.Conns.Insert(id, fields, model.NowISO())
	if err != nil {
		return model.ConnectionSummary{}, wrapErr(err)
	}
	if err := s.deps.Secrets.Set(id, password); err != nil {
		return model.ConnectionSummary{}, wrapErr(err)
	}
	s.emitListChanged()
	return created, nil
}

func (s *Service) Update(id string, in Input) (model.ConnectionSummary, error) {
	if err := in.Validate(); err != nil {
		return model.ConnectionSummary{}, err
	}

	var uri *string
	if in.Mode == "uri" {
		uri = in.URI
	}
	// Three-state convention: nil = unchanged, "" = clear, non-empty = replace.
	password := in.Password
	if in.Mode == "uri" && uri != nil && *uri != "" {
		stripped, pw := stripURIPassword(*uri)
		uri = &stripped
		// P2 R2: only a password actually typed into the URI's own userinfo overrides whatever
		// the caller sent — a passwordless URI (the common case: D7 always strips one out before
		// ever showing it back to the user) says nothing about the password, so in.Password's own
		// three-state value (nil/""/replace) must stand. The old unconditional override silently
		// discarded an explicit "" clear the moment the URI itself had no password to report,
		// which is every URI-mode save that doesn't retype credentials by hand.
		if pw != nil {
			password = pw
		}
	}

	// P25 D6: the row already exists, so — unlike Create — the secret can be written first; a
	// failure here (cipher unavailable) means Update never runs, leaving every other field
	// exactly as it was rather than a half-applied edit.
	if password != nil {
		var toStore *string
		if *password != "" {
			toStore = password
		}
		if err := s.deps.Secrets.Set(id, toStore); err != nil {
			return model.ConnectionSummary{}, wrapErr(err)
		}
	}

	fields := in.ConnectionFields
	fields.URI = uri
	updated, err := s.deps.Conns.Update(id, fields, model.NowISO())
	if err != nil {
		return model.ConnectionSummary{}, wrapErr(err)
	}
	s.emitListChanged()
	return updated, nil
}

func (s *Service) Duplicate(id string) (model.ConnectionSummary, error) {
	existing, err := s.deps.Conns.Get(id)
	if err != nil {
		return model.ConnectionSummary{}, wrapErr(err)
	}
	if existing == nil {
		return model.ConnectionSummary{}, ipcerr.Internal(fmt.Sprintf("connection %s not found", id))
	}
	newID := idgen.New()
	fields := existing.ConnectionFields
	fields.Name = fields.Name + " copy"
	created, err := s.deps.Conns.Insert(newID, fields, model.NowISO())
	if err != nil {
		return model.ConnectionSummary{}, wrapErr(err)
	}
	// P25 D11: a raw column copy, not decrypt-then-re-encrypt — the plaintext is never used, so
	// there is no reason for this path to need the OS key at all.
	if err := s.deps.Secrets.Copy(id, newID); err != nil {
		return model.ConnectionSummary{}, wrapErr(err)
	}
	s.emitListChanged()
	return created, nil
}

func (s *Service) Remove(id string) error {
	current := s.StateOf(id)
	if current.Status == "connected" || current.Status == "connecting" {
		_ = s.deps.Backend.Disconnect(context.Background(), id)
	}
	s.deps.Preconnect.Stop(id)
	if err := s.deps.Conns.Delete(id); err != nil { // cascades filters, metadata cache, saved queries
		return wrapErr(err)
	}
	if err := s.deps.Secrets.Delete(id); err != nil {
		return wrapErr(err)
	}
	s.mu.Lock()
	delete(s.states, id)
	s.mu.Unlock()
	s.emitListChanged()
	return nil
}

func (s *Service) Reorder(ids []string) ([]model.ConnectionSummary, error) {
	reordered, err := s.deps.Conns.Reorder(ids)
	if err != nil {
		return nil, wrapErr(err)
	}
	s.emitListChanged()
	return reordered, nil
}

// Reveal never errors (P25 D9): the renderer's edit dialog has no error handling around this
// call, so an undecryptable stored secret must not become an unhandled failure.
func (s *Service) Reveal(id string) RevealResult {
	password, err := s.deps.Secrets.Get(id)
	if err != nil {
		msg := errorMessage(err)
		slog.Warn(fmt.Sprintf("secret reveal failed for %s: %s", id, msg), "scope", "connections")
		return RevealResult{Password: nil, Error: &msg}
	}
	slog.Info(fmt.Sprintf("secret revealed for %s", id), "scope", "connections")
	return RevealResult{Password: password, Error: nil}
}

// Test never errors: a test run is never armed and never leaves a process behind, however it
// ended (the deferred Stop mirrors connections.ts:348-351's `finally`). It still runs the same
// Validate() Create/Update do (P2 R1: this was the one Input-accepting entry point that skipped
// it) — without that, an out-of-range Port reaches postgres/client.go's `uint16(*cfg.Port)`
// unchecked and silently wraps around to a different, in-range port instead of being rejected.
func (s *Service) Test(in Input) TestResult {
	if err := in.Validate(); err != nil {
		msg := errorMessage(err)
		return TestResult{OK: false, Error: &msg}
	}
	r := resolveFromInput(in)
	defer s.deps.Preconnect.Stop(r.config.ID)

	if r.preconnect != nil {
		if _, err := s.deps.Preconnect.Start(r.config.ID, *r.preconnect); err != nil {
			msg := errorMessage(err)
			return TestResult{OK: false, Error: &msg}
		}
	}
	serverVersion, err := s.deps.Backend.Test(context.Background(), r.config)
	if err != nil {
		msg := errorMessage(err)
		return TestResult{OK: false, Error: &msg}
	}
	return TestResult{OK: true, ServerVersion: &serverVersion}
}

// Connect deduplicates concurrent calls for the same id (D11): every caller that arrives while an
// attempt is already running gets that same attempt's result instead of starting a second one.
func (s *Service) Connect(id string) (model.ConnectionState, error) {
	s.mu.Lock()
	if a, ok := s.inFlight[id]; ok {
		s.mu.Unlock()
		<-a.done
		return a.state, a.err
	}
	a := &attempt{done: make(chan struct{})}
	s.inFlight[id] = a
	s.mu.Unlock()

	a.state, a.err = s.doConnect(id)
	close(a.done)

	s.mu.Lock()
	if s.inFlight[id] == a {
		delete(s.inFlight, id)
	}
	s.mu.Unlock()

	return a.state, a.err
}

// doConnect is connections.ts:170-231's port. Only the pre-checks below (the row not existing, or
// a real read failure) return a Go error; everything attemptConnect can fail on becomes this
// connection's error *state* instead, exactly as the TS's catch block does.
func (s *Service) doConnect(id string) (model.ConnectionState, error) {
	summary, err := s.deps.Conns.Get(id)
	if err != nil {
		return model.ConnectionState{}, wrapErr(err)
	}
	if summary == nil {
		return model.ConnectionState{}, ipcerr.Internal(fmt.Sprintf("connection %s not found", id))
	}

	s.emitState(model.ConnectionState{ConnectionID: id, Status: "connecting", Since: nowMillis()})

	state, connErr := s.attemptConnect(id)
	if connErr == nil {
		return state, nil
	}

	msg := errorMessage(connErr)
	errState := model.ConnectionState{ConnectionID: id, Status: "error", Error: &msg, Since: nowMillis()}
	s.emitState(errState)
	return errState, nil
}

// attemptConnect is doConnect's try block: resolve, optionally start the pre-connect script, call
// the engine, optionally arm the sidecar, and on success drop the cached metadata and push an
// invalidation.
func (s *Service) attemptConnect(id string) (model.ConnectionState, error) {
	r, err := resolve(s.deps.Conns, s.deps.Secrets, id)
	if err != nil {
		return model.ConnectionState{}, err
	}

	started := false
	if r.preconnect != nil {
		if _, err := s.deps.Preconnect.Start(id, *r.preconnect); err != nil {
			return model.ConnectionState{}, err
		}
		started = true
	}

	result, err := s.deps.Backend.Connect(context.Background(), r.config)
	if err != nil {
		if started {
			s.deps.Preconnect.Stop(id)
		}
		return model.ConnectionState{}, err
	}

	if r.preconnectSidecar {
		// D7 (§4.4): overrides the settle-window auto-detection — always arm() here. A no-op if
		// the script already exited; may synchronously flip this connection to 'error' via
		// onPreconnectExit if it died between Start and here.
		s.deps.Preconnect.Arm(id)
	}
	if afterArm := s.StateOf(id); afterArm.Status == "error" {
		return afterArm, nil
	}

	state := model.ConnectionState{
		ConnectionID: id, Status: "connected", ServerVersion: &result.ServerVersion,
		Since: nowMillis(), Caps: result.Caps,
	}
	s.emitState(state)
	// D11 (Step 6a numbering): the whole connection's metadata is refreshed on every reconnect.
	_ = s.deps.Metadata.DropConnection(id)
	s.metadataInvalidated.Emit(id)
	return state, nil
}

func (s *Service) Disconnect(id string) (model.ConnectionState, error) {
	s.deps.Preconnect.Stop(id)
	_ = s.deps.Backend.Disconnect(context.Background(), id)
	// Cached metadata stays — "metadata stays, it is on disk".
	state := model.ConnectionState{ConnectionID: id, Status: "disconnected", Since: nowMillis()}
	s.emitState(state)
	return state, nil
}

// States returns every known state sorted by connection id (D7): Go map iteration is randomised,
// so a literal port of `[...states.values()]` would hand the renderer a different order on every
// call.
func (s *Service) States() []model.ConnectionState {
	s.mu.Lock()
	out := make([]model.ConnectionState, 0, len(s.states))
	for _, st := range s.states {
		out = append(out, st)
	}
	s.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].ConnectionID < out[j].ConnectionID })
	return out
}

func (s *Service) StateOf(id string) model.ConnectionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st, ok := s.states[id]; ok {
		return st
	}
	return model.ConnectionState{ConnectionID: id, Status: "disconnected", Since: nowMillis()}
}

func (s *Service) SecretsStatus() secrets.Status { return s.deps.Cipher.Status() }

func (s *Service) OnStateChange(fn func(model.ConnectionState)) (unsubscribe func()) {
	return s.stateChanged.Subscribe(fn)
}

func (s *Service) OnMetadataInvalidated(fn func(connectionID string)) (unsubscribe func()) {
	return s.metadataInvalidated.Subscribe(fn)
}

func (s *Service) OnListChanged(fn func([]model.ConnectionSummary)) (unsubscribe func()) {
	return s.listChanged.Subscribe(fn)
}
