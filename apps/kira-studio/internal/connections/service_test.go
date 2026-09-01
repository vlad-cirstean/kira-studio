package connections_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/preconnect"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

// fakeBackend replaces the real adapterhost.Router (via a real Node engine fixture) these tests
// used before P58f Phase 4 deleted the Node sidecar — every kind has been Go-native since P58e
// M9.3, so there is no more Node-served path left to exercise here, only Backend's own contract.
// Connect blocks on release until it is closed, for TestInFlightConnectDedupe's slow-connect case.
type fakeBackend struct {
	mu         sync.Mutex
	lastConfig model.ResolvedConnectionConfig
	connectN   atomic.Int64
	testN      atomic.Int64
	release    chan struct{}
}

func newFakeBackend() *fakeBackend { return &fakeBackend{release: make(chan struct{})} }

func (b *fakeBackend) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig) (connections.ConnectResult, error) {
	b.mu.Lock()
	b.lastConfig = cfg
	b.mu.Unlock()
	b.connectN.Add(1)
	if cfg.Name == "slow-conn" {
		<-b.release
	}
	return connections.ConnectResult{ServerVersion: "1.0", Caps: map[string]any{}}, nil
}

// Test never itself rejects a bad Port the way a real adapter would (postgres/client.go's
// uint16(*cfg.Port) truncation being the concrete case, P2 R1) — it always answers OK, so
// TestTestValidatesInputBeforeProbing below can only pass by Service.Test's own Validate() call
// stopping a bad request before it ever reaches here.
func (b *fakeBackend) Test(ctx context.Context, cfg model.ResolvedConnectionConfig) (string, error) {
	b.testN.Add(1)
	return "1.0", nil
}

func (b *fakeBackend) Disconnect(ctx context.Context, connectionID string) error { return nil }

func (b *fakeBackend) releaseSlow() { close(b.release) }

func (b *fakeBackend) connectCount() int { return int(b.connectN.Load()) }

func (b *fakeBackend) testCount() int { return int(b.testN.Load()) }

func (b *fakeBackend) lastConnectConfig() model.ResolvedConnectionConfig {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.lastConfig
}

// fakeAuthorizer replaces the real internal/localauth.Authorizer (P14): a canned outcome/error per
// call, with the (reason, confirmed) arguments it was actually called with recorded, so a test can
// both drive Reveal's response and assert the gate saw what it should have. Defaults to Granted —
// harmless for every test that doesn't itself exercise Reveal.
type fakeAuthorizer struct {
	mu            sync.Mutex
	outcome       localauth.Outcome
	err           error
	calls         int
	lastConfirmed bool
}

func newFakeAuthorizer() *fakeAuthorizer { return &fakeAuthorizer{outcome: localauth.Granted} }

func (f *fakeAuthorizer) Authorize(reason string, confirmed bool) (localauth.Outcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastConfirmed = confirmed
	return f.outcome, f.err
}

func (f *fakeAuthorizer) setOutcome(outcome localauth.Outcome, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.outcome, f.err = outcome, err
}

func (f *fakeAuthorizer) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// harness wires a real SQLite db (through the real migrations), a real available cipher (the
// Linux KIRA_INSECURE_SECRETS fallback), a fakeBackend, a fakeAuthorizer, and a real preconnect
// supervisor behind one connections.Service.
type harness struct {
	svc     *connections.Service
	repos   *repos.Repos
	secrets *repos.SecretsRepo
	backend *fakeBackend
	auth    *fakeAuthorizer
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())
	t.Setenv("KIRA_INSECURE_SECRETS", "1")

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	cipher := secrets.New()
	if !cipher.Status().Available {
		t.Fatalf("cipher unavailable: %+v", cipher.Status())
	}
	secretsRepo := repos.NewSecrets(db.DB, cipher)
	pre := preconnect.New()
	backend := newFakeBackend()
	auth := newFakeAuthorizer()

	svc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Auth: auth, Backend: backend, Preconnect: pre,
	})
	svc.Start()
	t.Cleanup(svc.Shutdown)

	return &harness{svc: svc, repos: r, secrets: secretsRepo, backend: backend, auth: auth}
}

// fieldsInput returns a valid, connectable fields-mode Input for name. Kind is "kafka", any real,
// valid connection kind (model.ValidConnectionKind requires one) — fakeBackend does not
// distinguish between kinds.
func fieldsInput(name string) connections.Input {
	return connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: name, Kind: "kafka", Color: "blue", Mode: "fields",
			Host: strPtr("localhost"), Port: intPtr(5432), Options: map[string]any{},
		},
	}
}

// newUnavailableCipherHarness is newHarness without KIRA_INSECURE_SECRETS set — on this Linux
// sandbox that leaves the real probe naturally unavailable, exercising the actual refusal path
// rather than a fake one.
func newUnavailableCipherHarness(t *testing.T) *harness {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	cipher := secrets.New()
	if cipher.Status().Available {
		t.Fatalf("cipher unexpectedly available: %+v", cipher.Status())
	}
	secretsRepo := repos.NewSecrets(db.DB, cipher)
	pre := preconnect.New()
	backend := newFakeBackend()
	auth := newFakeAuthorizer()

	svc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Auth: auth, Backend: backend, Preconnect: pre,
	})
	svc.Start()
	t.Cleanup(svc.Shutdown)

	return &harness{svc: svc, repos: r, secrets: secretsRepo, backend: backend, auth: auth}
}

// serviceWithUnavailableCipher builds a second Service over h's own db/repos, but with a cipher
// forced unavailable (by momentarily hiding KIRA_INSECURE_SECRETS for the one secrets.New() call
// that reads it — safe here since nothing else touches that env var concurrently within a test).
// It never touches Host/Preconnect, so nil deps for those are fine: this is only ever used to
// exercise Update, which does not call either.
func (h *harness) serviceWithUnavailableCipher(t *testing.T) *connections.Service {
	t.Helper()
	old, existed := os.LookupEnv("KIRA_INSECURE_SECRETS")
	_ = os.Unsetenv("KIRA_INSECURE_SECRETS")
	cipher := secrets.New()
	if existed {
		_ = os.Setenv("KIRA_INSECURE_SECRETS", old)
	}
	if cipher.Status().Available {
		t.Fatalf("cipher unexpectedly available: %+v", cipher.Status())
	}
	secretsRepo := repos.NewSecrets(h.repos.Connections.DB, cipher)
	return connections.New(connections.Deps{
		Conns: h.repos.Connections, Secrets: secretsRepo, Metadata: h.repos.Metadata, Cipher: cipher,
	})
}

func mustCreate(t *testing.T, svc *connections.Service, in connections.Input) model.ConnectionSummary {
	t.Helper()
	created, err := svc.Create(in)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return created
}

func asIpcErr(t *testing.T, err error) *ipcerr.Error {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	return ie
}

// TestPasswordThreeStateConvention pins Update's three-state password contract — nil leaves the
// stored secret alone, "" clears it, non-empty replaces it — which a naive `if password != nil`
// collapses into two states and silently wipes credentials on every unrelated edit.
func TestPasswordThreeStateConvention(t *testing.T) {
	h := newHarness(t)
	in := fieldsInput("pw-conn")
	in.Password = strPtr("secret1")
	created := mustCreate(t, h.svc, in)

	get := func() *string {
		v, err := h.secrets.Get(created.ID)
		if err != nil {
			t.Fatalf("Secrets.Get: %v", err)
		}
		return v
	}
	if v := get(); v == nil || *v != "secret1" {
		t.Fatalf("initial secret = %v, want secret1", v)
	}

	// nil = unchanged.
	unchanged := fieldsInput("pw-conn")
	if _, err := h.svc.Update(created.ID, unchanged); err != nil {
		t.Fatalf("Update(nil password): %v", err)
	}
	if v := get(); v == nil || *v != "secret1" {
		t.Errorf("after nil-password update, secret = %v, want unchanged secret1", v)
	}

	// "" = clear.
	cleared := fieldsInput("pw-conn")
	cleared.Password = strPtr("")
	if _, err := h.svc.Update(created.ID, cleared); err != nil {
		t.Fatalf("Update(clear password): %v", err)
	}
	if v := get(); v != nil {
		t.Errorf("after clearing, secret = %v, want nil", *v)
	}

	// non-empty = replace.
	replaced := fieldsInput("pw-conn")
	replaced.Password = strPtr("secret2")
	if _, err := h.svc.Update(created.ID, replaced); err != nil {
		t.Fatalf("Update(replace password): %v", err)
	}
	if v := get(); v == nil || *v != "secret2" {
		t.Errorf("after replacing, secret = %v, want secret2", v)
	}
}

// TestUriPasswordStripAndInject is the end-to-end statement of the URI secret rule: the password
// is stripped out of the URI before the row is written (so it is never persisted in cleartext)
// and re-injected only into the config handed to the engine.
func TestUriPasswordStripAndInject(t *testing.T) {
	h := newHarness(t)
	in := connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "uri-conn", Kind: "kafka", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u:p@h:5432/db"), Options: map[string]any{},
		},
	}
	created := mustCreate(t, h.svc, in)

	if created.URI == nil || *created.URI != "postgresql://u@h:5432/db" {
		t.Fatalf("stored URI = %v, want a passwordless postgresql://u@h:5432/db", created.URI)
	}
	secret, err := h.secrets.Get(created.ID)
	if err != nil {
		t.Fatalf("Secrets.Get: %v", err)
	}
	if secret == nil || *secret != "p" {
		t.Fatalf("stored secret = %v, want p", secret)
	}

	if _, err := h.svc.Connect(created.ID); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if got := h.backend.lastConnectConfig().URI; got == nil || *got != "postgresql://u:p@h:5432/db" {
		t.Errorf("backend-bound uri = %v, want the password re-injected", got)
	}
}

// TestUriModeUpdateHonorsExplicitPasswordClear pins P2 R2's fix: a URI-mode Update whose typed URI
// carries no password of its own (the normal shape — D7 always strips one out before ever showing
// it back to the user) must still honor an explicit "" clear signal in in.Password, rather than
// silently discarding it in favor of "unchanged" just because the URI itself said nothing. Without
// the fix, the only way this scenario arises in the real dialog (toggle to fields mode, clear the
// password there, toggle back to URI mode, save) always left the old secret in place.
func TestUriModeUpdateHonorsExplicitPasswordClear(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "uri-clear", Kind: "kafka", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u:p@h:5432/db"), Options: map[string]any{},
		},
	})

	cleared := strPtr("")
	if _, err := h.svc.Update(created.ID, connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "uri-clear", Kind: "kafka", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u@h:5432/db"), Options: map[string]any{},
		},
		Password: cleared,
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	secret, err := h.secrets.Get(created.ID)
	if err != nil {
		t.Fatalf("Secrets.Get: %v", err)
	}
	if secret != nil {
		t.Fatalf("secret = %v, want nil (cleared)", *secret)
	}
}

// TestUriModeUpdateWithNoPasswordSignalLeavesSecretUnchanged is the companion case: a URI-mode
// Update whose URI has no password and whose in.Password is nil (never touched — the ordinary
// shape of an edit that doesn't concern itself with credentials at all) must still leave the
// existing secret alone.
func TestUriModeUpdateWithNoPasswordSignalLeavesSecretUnchanged(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "uri-untouched", Kind: "kafka", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u:p@h:5432/db"), Options: map[string]any{},
		},
	})

	if _, err := h.svc.Update(created.ID, connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "uri-untouched-renamed", Kind: "kafka", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u@h:5432/db"), Options: map[string]any{},
		},
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	secret, err := h.secrets.Get(created.ID)
	if err != nil {
		t.Fatalf("Secrets.Get: %v", err)
	}
	if secret == nil || *secret != "p" {
		t.Fatalf("secret = %v, want unchanged p", secret)
	}
}

// TestCreateValidatesSecretBeforeWriting covers half of the deliberately asymmetric write
// ordering: Create must prove the secret can be encrypted BEFORE inserting, so an unavailable
// cipher leaves no half-written row behind.
func TestCreateValidatesSecretBeforeWriting(t *testing.T) {
	h := newUnavailableCipherHarness(t)

	before, err := h.svc.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	withPassword := fieldsInput("should-not-exist")
	withPassword.Password = strPtr("x")
	_, err = h.svc.Create(withPassword)
	if err == nil {
		t.Fatalf("Create with an unavailable cipher: want an error")
	}
	if ie := asIpcErr(t, err); ie.Code != "E_SECRET_STORE" {
		t.Errorf("Code = %q, want E_SECRET_STORE", ie.Code)
	}
	after, err := h.svc.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(after) != len(before) {
		t.Errorf("List() grew from %d to %d — a row was left behind despite the failed Create", len(before), len(after))
	}

	withoutPassword := fieldsInput("no-password-needed")
	if _, err := h.svc.Create(withoutPassword); err != nil {
		t.Errorf("Create with a nil password on an unavailable cipher: %v, want success", err)
	}
}

// TestUpdateWritesSecretBeforeRow is the other half: the row already exists, so Update writes the
// secret first and a cipher failure must abort before any other field is touched — a half-applied
// edit is the failure mode this ordering exists to prevent.
func TestUpdateWritesSecretBeforeRow(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, fieldsInput("original-name"))

	unavailable := h.serviceWithUnavailableCipher(t)
	withPassword := fieldsInput("changed-name")
	withPassword.Password = strPtr("x")
	_, err := unavailable.Update(created.ID, withPassword)
	if err == nil {
		t.Fatalf("Update with an unavailable cipher: want an error")
	}
	if ie := asIpcErr(t, err); ie.Code != "E_SECRET_STORE" {
		t.Errorf("Code = %q, want E_SECRET_STORE", ie.Code)
	}

	row, err := h.repos.Connections.Get(created.ID)
	if err != nil {
		t.Fatalf("Connections.Get: %v", err)
	}
	if row == nil || row.Name != "original-name" {
		t.Errorf("row = %+v, want Name unchanged at original-name", row)
	}
}

// TestInFlightConnectDedupe covers the in-flight attempt map: eight concurrent Connect calls for
// one id must share a single attempt — identical results for every caller, and exactly one
// adapter:connect on the wire.
func TestInFlightConnectDedupe(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, fieldsInput("slow-conn"))

	const n = 8
	results := make([]model.ConnectionState, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = h.svc.Connect(created.ID)
		}(i)
	}

	// Give every goroutine time to reach the shared in-flight attempt before releasing it.
	time.Sleep(200 * time.Millisecond)
	h.backend.releaseSlow()
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("Connect[%d]: %v", i, err)
		}
		if results[i].Status != "connected" {
			t.Fatalf("Connect[%d].Status = %q, want connected", i, results[i].Status)
		}
		if diff := cmp.Diff(results[0], results[i]); diff != "" {
			t.Errorf("Connect[%d] mismatch vs Connect[0] (-want +got):\n%s", i, diff)
		}
	}

	if n := h.backend.connectCount(); n != 1 {
		t.Errorf("Backend.Connect was called %d times, want exactly 1", n)
	}
}

// TestTestValidatesInputBeforeProbing is a regression test for the P2 R1 finding where Test was
// the one Input-accepting entry point (unlike Create/Update) that never called Validate() —  a
// port outside 1-65535 reached the backend unchecked, and postgres/client.go's own
// `uint16(*cfg.Port)` would silently wrap it around to a different, in-range port rather than
// erroring. fakeBackend.Test never rejects a bad port itself, so this can only pass if
// Service.Test's own Validate() call stops the request before the backend is ever reached.
func TestTestValidatesInputBeforeProbing(t *testing.T) {
	h := newHarness(t)
	in := fieldsInput("bad-port")
	badPort := 70000 // out of range; uint16(70000) would silently become 4464
	in.Port = &badPort

	result := h.svc.Test(in, "")

	if result.OK {
		t.Fatal("Test(port: 70000).OK = true, want a validation failure")
	}
	if result.Error == nil || !strings.Contains(*result.Error, "port") {
		t.Fatalf("Test(port: 70000).Error = %v, want a message naming the port", result.Error)
	}
	if n := h.backend.testCount(); n != 0 {
		t.Errorf("Backend.Test was called %d times, want 0 — Validate() should have short-circuited first", n)
	}
}
