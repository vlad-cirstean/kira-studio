package connections_test

import (
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/preconnect"
	"github.com/kirathecat/kira-studio/shell/internal/secrets"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

// harness wires a real SQLite db (through the real migrations), a real available cipher (the
// Linux KIRA_INSECURE_SECRETS fallback), a real vendored-Node engine fixture, and a real
// preconnect supervisor behind one connections.Service.
type harness struct {
	svc     *connections.Service
	repos   *repos.Repos
	secrets *repos.SecretsRepo
	host    *enginehost.Host
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
	host := enginetest.Host(t)
	pre := preconnect.New()

	svc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Host: host, Preconnect: pre,
	})
	svc.Start()
	t.Cleanup(svc.Shutdown)

	return &harness{svc: svc, repos: r, secrets: secretsRepo, host: host}
}

// fieldsInput returns a valid, connectable fields-mode Input for name — the fixture's
// adapter:connect/adapter:test key their canned behaviour off Name's prefix.
func fieldsInput(name string) connections.Input {
	return connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: name, Kind: "postgres", Color: "blue", Mode: "fields",
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
	host := enginetest.Host(t)
	pre := preconnect.New()

	svc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Host: host, Preconnect: pre,
	})
	svc.Start()
	t.Cleanup(svc.Shutdown)

	return &harness{svc: svc, repos: r, secrets: secretsRepo, host: host}
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
			Name: "uri-conn", Kind: "postgres", Color: "blue", Mode: "uri",
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
	payload, err := h.host.Call("fixture:last-connect-config", nil)
	if err != nil {
		t.Fatalf("fixture:last-connect-config: %v", err)
	}
	var got struct {
		Config struct {
			URI string `json:"uri"`
		} `json:"config"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Config.URI != "postgresql://u:p@h:5432/db" {
		t.Errorf("engine-bound uri = %q, want the password re-injected", got.Config.URI)
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
	if _, err := h.host.Call("fixture:release-slow", nil); err != nil {
		t.Fatalf("fixture:release-slow: %v", err)
	}
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

	payload, err := h.host.Call("fixture:request-count", map[string]any{"op": "adapter:connect"})
	if err != nil {
		t.Fatalf("fixture:request-count: %v", err)
	}
	var count struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(payload, &count); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if count.Count != 1 {
		t.Errorf("adapter:connect was called %d times, want exactly 1", count.Count)
	}
}
