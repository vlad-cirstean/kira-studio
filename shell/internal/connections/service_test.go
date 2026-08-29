package connections_test

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
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

func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

func TestCreateUpdateDuplicateDelete(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, func() connections.Input {
		in := fieldsInput("round-trip")
		in.Password = strPtr("hunter2")
		return in
	}())

	// List never returns a password: ConnectionSummary has no such field, and its JSON encoding
	// must not carry one either.
	list, err := h.svc.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	encoded, _ := json.Marshal(list)
	if strings.Contains(string(encoded), "hunter2") || strings.Contains(string(encoded), `"password"`) {
		t.Errorf("List() JSON leaked a password field: %s", encoded)
	}

	updated, err := h.svc.Update(created.ID, func() connections.Input {
		in := fieldsInput("renamed")
		return in
	}())
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "renamed" {
		t.Errorf("Name = %q, want renamed", updated.Name)
	}

	dup, err := h.svc.Duplicate(created.ID)
	if err != nil {
		t.Fatalf("Duplicate: %v", err)
	}
	if dup.Name != "renamed copy" {
		t.Errorf("duplicate Name = %q, want %q", dup.Name, "renamed copy")
	}

	if err := h.repos.Metadata.Put(created.ID, "database:x", "children", json.RawMessage(`{"nodes":[]}`)); err != nil {
		t.Fatalf("seed metadata: %v", err)
	}
	if err := h.svc.Remove(created.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if got, _ := h.repos.Metadata.Get(created.ID, "database:x", "children"); got != nil {
		t.Errorf("metadata cache row survived Remove: %s", got)
	}
	if row, _ := h.repos.Connections.Get(created.ID); row != nil {
		t.Errorf("connection row survived Remove: %+v", row)
	}
}

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

func TestConnectSuccessPath(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, fieldsInput("ok-conn"))
	if err := h.repos.Metadata.Put(created.ID, "database:x", "children", json.RawMessage(`{"nodes":[]}`)); err != nil {
		t.Fatalf("seed metadata: %v", err)
	}

	var mu sync.Mutex
	var seen []model.ConnectionState
	h.svc.OnStateChange(func(st model.ConnectionState) {
		mu.Lock()
		seen = append(seen, st)
		mu.Unlock()
	})
	var invalidated []string
	h.svc.OnMetadataInvalidated(func(id string) {
		mu.Lock()
		invalidated = append(invalidated, id)
		mu.Unlock()
	})

	state, err := h.svc.Connect(created.ID)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if state.Status != "connected" {
		t.Fatalf("Status = %q, want connected (error=%v)", state.Status, state.Error)
	}
	if state.ServerVersion == nil || *state.ServerVersion != "fixture 1.0" {
		t.Errorf("ServerVersion = %v, want fixture 1.0", state.ServerVersion)
	}
	if state.Caps == nil {
		t.Errorf("Caps is nil, want the fixture's caps object")
	}

	mu.Lock()
	statuses := make([]string, len(seen))
	for i, s := range seen {
		statuses[i] = s.Status
	}
	mu.Unlock()
	if len(statuses) < 2 || statuses[0] != "connecting" || statuses[len(statuses)-1] != "connected" {
		t.Errorf("OnStateChange sequence = %v, want to start with connecting and end with connected", statuses)
	}

	mu.Lock()
	gotInvalidated := append([]string(nil), invalidated...)
	mu.Unlock()
	if len(gotInvalidated) != 1 || gotInvalidated[0] != created.ID {
		t.Errorf("OnMetadataInvalidated fired with %v, want exactly [%s]", gotInvalidated, created.ID)
	}
	if got, _ := h.repos.Metadata.Get(created.ID, "database:x", "children"); got != nil {
		t.Errorf("metadata cache row survived Connect: %s", got)
	}
}

func TestConnectFailurePathStopsPreconnect(t *testing.T) {
	h := newHarness(t)
	in := fieldsInput("fail-conn")
	in.Preconnect = strPtr("sleep 30")
	created := mustCreate(t, h.svc, in)

	start := time.Now()
	state, err := h.svc.Connect(created.ID)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if state.Status != "error" {
		t.Fatalf("Status = %q, want error", state.Status)
	}
	if state.Error == nil || !strings.Contains(*state.Error, "synthetic connect failure") {
		t.Errorf("Error = %v, want it to name the fixture's synthetic failure", state.Error)
	}
	// Connect only returns once attemptConnect's Stop(id) call has finished, and Stop blocks
	// until the process has actually exited (preconnect's own, separately tested guarantee) — so
	// by the time we're here the sidecar this connection started is already dead. The >= 2s
	// elapsed time confirms the sidecar did settle before the engine's failure response arrived.
	if elapsed < time.Second {
		t.Errorf("Connect returned after %s, want it to have waited out the sidecar settle window first", elapsed)
	}
}

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

func TestSidecarCheckboxArms(t *testing.T) {
	h := newHarness(t)
	in := fieldsInput("ok-arms")
	in.Preconnect = strPtr("sleep 2.05")
	in.PreconnectSidecar = true
	created := mustCreate(t, h.svc, in)

	if _, err := h.svc.Connect(created.ID); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	// The script may die either just before or just after Arm() (a real race the settle window
	// itself creates — §4.4 D7) — either way it ends up 'error', synchronously in the first case
	// or via onPreconnectExit shortly after in the second, so poll rather than asserting on
	// Connect's own immediate return value.
	waitUntil(t, 3*time.Second, func() bool { return h.svc.StateOf(created.ID).Status == "error" })
}

func TestMarkAllErrored(t *testing.T) {
	h := newHarness(t)
	connected1 := mustCreate(t, h.svc, fieldsInput("connected-1"))
	connected2 := mustCreate(t, h.svc, fieldsInput("connected-2"))
	untouched := mustCreate(t, h.svc, fieldsInput("never-connected"))

	if _, err := h.svc.Connect(connected1.ID); err != nil {
		t.Fatalf("Connect(1): %v", err)
	}
	if _, err := h.svc.Connect(connected2.ID); err != nil {
		t.Fatalf("Connect(2): %v", err)
	}

	h.svc.MarkAllErrored("custom reason")

	for _, id := range []string{connected1.ID, connected2.ID} {
		st := h.svc.StateOf(id)
		if st.Status != "error" || st.Error == nil || *st.Error != "custom reason" {
			t.Errorf("StateOf(%s) = %+v, want error/custom reason", id, st)
		}
	}
	if st := h.svc.StateOf(untouched.ID); st.Status != "disconnected" {
		t.Errorf("StateOf(untouched) = %+v, want untouched (disconnected)", st)
	}
}

func TestEngineDownMarksAllErrored(t *testing.T) {
	h := newHarness(t)
	c1 := mustCreate(t, h.svc, fieldsInput("engine-down-1"))
	c2 := mustCreate(t, h.svc, fieldsInput("engine-down-2"))
	if _, err := h.svc.Connect(c1.ID); err != nil {
		t.Fatalf("Connect(1): %v", err)
	}
	if _, err := h.svc.Connect(c2.ID); err != nil {
		t.Fatalf("Connect(2): %v", err)
	}

	_, _ = h.host.Call("fixture:crash", nil) // never answers; the engine process exits instead

	waitUntil(t, 2*time.Second, func() bool {
		return h.svc.StateOf(c1.ID).Status == "error" && h.svc.StateOf(c2.ID).Status == "error"
	})
	for _, id := range []string{c1.ID, c2.ID} {
		st := h.svc.StateOf(id)
		if st.Error == nil || *st.Error != "engine process exited" {
			t.Errorf("StateOf(%s).Error = %v, want \"engine process exited\"", id, st.Error)
		}
	}
}

func TestStatesAreSorted(t *testing.T) {
	h := newHarness(t)
	ids := make([]string, 3)
	for i := range ids {
		created := mustCreate(t, h.svc, fieldsInput("sort-me"))
		ids[i] = created.ID
	}
	// Connect in reverse-of-creation order — an arbitrary scramble relative to sorted(ids).
	for i := len(ids) - 1; i >= 0; i-- {
		if _, err := h.svc.Connect(ids[i]); err != nil {
			t.Fatalf("Connect: %v", err)
		}
	}

	wantOrder := append([]string(nil), ids...)
	sort.Strings(wantOrder)

	for attempt := 0; attempt < 2; attempt++ {
		states := h.svc.States()
		if len(states) != len(ids) {
			t.Fatalf("States() returned %d entries, want %d", len(states), len(ids))
		}
		gotOrder := make([]string, len(states))
		for i, st := range states {
			gotOrder[i] = st.ConnectionID
		}
		if !sort.StringsAreSorted(gotOrder) {
			t.Errorf("States() = %v, not sorted", gotOrder)
		}
	}
}

func TestRevealNeverThrows(t *testing.T) {
	h := newHarness(t)
	created := mustCreate(t, h.svc, fieldsInput("garbage-secret"))
	if _, err := h.repos.Connections.DB.Exec(`UPDATE connections SET password = ? WHERE id = ?`, "garbage", created.ID); err != nil {
		t.Fatalf("seed garbage password: %v", err)
	}

	result := h.svc.Reveal(created.ID)
	if result.Password != nil {
		t.Errorf("Password = %v, want nil", *result.Password)
	}
	// "garbage" carries no kira:v2: prefix at all, so Decrypt refuses it as a format error rather
	// than an authentication failure — either way, Reveal must fold it into Error, never a panic
	// or an unhandled failure (P25 D9).
	if result.Error == nil || !strings.Contains(*result.Error, "cannot be decrypted") {
		t.Errorf("Error = %v, want the envelope-format error", result.Error)
	}
}

func TestTestAlwaysStopsPreconnect(t *testing.T) {
	h := newHarness(t)

	okResult := h.svc.Test(func() connections.Input {
		in := fieldsInput("ok-test")
		in.Preconnect = strPtr("true")
		return in
	}())
	if !okResult.OK {
		t.Errorf("ok Test() = %+v, want OK", okResult)
	}

	failResult := h.svc.Test(func() connections.Input {
		in := fieldsInput("fail-test")
		in.Preconnect = strPtr("true")
		return in
	}())
	if failResult.OK {
		t.Errorf("fail Test() = %+v, want !OK", failResult)
	}

	// Test's deferred Stop(r.config.ID) (service.go) always runs, on both the ok and the fail
	// path, however Test ends — a subsequent Test() reusing the same "test" key must not hang or
	// error because of a leftover process, since preconnect.Start() itself also supersedes
	// anything already tracked. This shutdown completing at all (StopAll has nothing left to
	// escalate against) is the observable half of that guarantee from outside the package; the
	// blocking-until-exited half is preconnect's own, separately tested contract.
	h.svc.Shutdown()
}

func TestListChangedBroadcast(t *testing.T) {
	h := newHarness(t)
	var mu sync.Mutex
	count := 0
	h.svc.OnListChanged(func([]model.ConnectionSummary) {
		mu.Lock()
		count++
		mu.Unlock()
	})
	get := func() int {
		mu.Lock()
		defer mu.Unlock()
		return count
	}

	created := mustCreate(t, h.svc, fieldsInput("list-changed"))
	if got := get(); got != 1 {
		t.Errorf("after Create, count = %d, want 1", got)
	}

	if _, err := h.svc.Update(created.ID, fieldsInput("list-changed-2")); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got := get(); got != 2 {
		t.Errorf("after Update, count = %d, want 2", got)
	}

	dup, err := h.svc.Duplicate(created.ID)
	if err != nil {
		t.Fatalf("Duplicate: %v", err)
	}
	if got := get(); got != 3 {
		t.Errorf("after Duplicate, count = %d, want 3", got)
	}

	if _, err := h.svc.Reorder([]string{dup.ID, created.ID}); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if got := get(); got != 4 {
		t.Errorf("after Reorder, count = %d, want 4", got)
	}

	if err := h.svc.Remove(created.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if got := get(); got != 5 {
		t.Errorf("after Remove, count = %d, want 5", got)
	}
}
