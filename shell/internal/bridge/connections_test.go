package bridge_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/preconnect"
	"github.com/kirathecat/kira-studio/shell/internal/secrets"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

func newConnectionsService(t *testing.T) *bridge.ConnectionsService {
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
	secretsRepo := repos.NewSecrets(db.DB, cipher)
	host := enginetest.Host(t)
	pre := preconnect.New()

	svc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Host: host, Preconnect: pre,
	})
	svc.Start()
	t.Cleanup(svc.Shutdown)

	return &bridge.ConnectionsService{Deps: appcore.Deps{Connections: svc}}
}

func TestConnectionsServiceList(t *testing.T) {
	s := newConnectionsService(t)
	if _, err := s.Create(connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "seeded", Kind: "postgres", Color: "blue", Mode: "fields",
			Host: strPtrCT("localhost"), Port: intPtrCT(5432), Options: map[string]any{},
		},
	}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	list, err := s.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 || list[0].Name != "seeded" {
		t.Errorf("List() = %+v, want one connection named seeded", list)
	}
}

func TestConnectionsServiceCreateInvalidInput(t *testing.T) {
	s := newConnectionsService(t)
	_, err := s.Create(connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "", Kind: "postgres", Color: "blue", Mode: "fields", Options: map[string]any{},
		},
	})
	if err == nil {
		t.Fatalf("Create with an empty name: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_BAD_REQUEST" {
		t.Errorf("Code = %q, want E_BAD_REQUEST", ie.Code)
	}
	if ie.Message != "name must be 1-120 characters" {
		t.Errorf("Message = %q, want the Validate() rule's own message", ie.Message)
	}
}

func TestConnectionsServiceSecretsStatus(t *testing.T) {
	s := newConnectionsService(t)
	status, err := s.SecretsStatus()
	if err != nil {
		t.Fatalf("SecretsStatus: %v", err)
	}

	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var asMap map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &asMap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	wantKeys := []string{"available", "backend", "insecureFallback", "reason"}
	if len(asMap) != len(wantKeys) {
		t.Fatalf("SecretsStatus() JSON has keys %v, want exactly %v", keysOf(asMap), wantKeys)
	}
	for _, k := range wantKeys {
		if _, ok := asMap[k]; !ok {
			t.Errorf("SecretsStatus() JSON missing key %q", k)
		}
	}
	if !status.Available || status.Backend != "basic_text" || !status.InsecureFallback {
		t.Errorf("status = %+v, want the KIRA_INSECURE_SECRETS fallback shape", status)
	}
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func strPtrCT(s string) *string { return &s }
func intPtrCT(i int) *int       { return &i }
