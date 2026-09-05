package bridge

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/grpcclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// TestMaskGrpcError_MasksMessageAndPartial is P11 D10's own unit-level assertion, mirroring
// bridge/http_test.go's TestMaskSendErrTimeline_MasksFailedSendHopURL: a *grpcclient.Error's own
// Message — and, for a partial stream result, its StatusMessage/Header/Trailer values — must be
// masked back to {{name}} form before mapGrpcError ever turns it into ipcerr.Error.Details, a
// copyable surface (§0.3). The full persistence-round-trip case (through a real migrated SQLite
// database, mirroring TestMaskSecrets_RedirectURLsFinalURLAndTimelineHopsBeforePersisting) is
// grpc_history_test.go (C7), once grpc_call_history exists to persist into.
func TestMaskGrpcError_MasksMessageAndPartial(t *testing.T) {
	const secret = "sk_live_super_secret_token"
	const masked = "{{apiToken}}"
	used := map[string]string{"apiToken": secret}

	err := grpcclient.Transport("dial tcp: bearer " + secret + " rejected")
	err.Partial = &grpcclient.CallResult{
		StatusMessage: "denied for token " + secret,
		Header:        []grpcclient.MetaPair{{Name: "x-upstream", Value: "seen " + secret}},
		Trailer:       []grpcclient.MetaPair{{Name: "x-detail", Value: "retry with " + secret}},
	}

	maskGrpcError(err, used)

	assertMasked := func(t *testing.T, label, s string) {
		t.Helper()
		if strings.Contains(s, secret) {
			t.Errorf("%s = %q still contains the raw secret", label, s)
		}
		if !strings.Contains(s, masked) {
			t.Errorf("%s = %q, want it to contain %q", label, s, masked)
		}
	}
	assertMasked(t, "Message", err.Message)
	assertMasked(t, "Partial.StatusMessage", err.Partial.StatusMessage)
	assertMasked(t, "Partial.Header[0].Value", err.Partial.Header[0].Value)
	assertMasked(t, "Partial.Trailer[0].Value", err.Partial.Trailer[0].Value)
}

// TestMaskGrpcError_NoOpWithNothingUsed confirms maskGrpcError never touches an error when no
// secret was actually substituted — the same "a no-op when there is no rendered exchange or no
// secret was actually substituted" contract maskSecrets (bridge/http.go) documents.
func TestMaskGrpcError_NoOpWithNothingUsed(t *testing.T) {
	err := grpcclient.BadRequest("plain message, nothing resolved")
	maskGrpcError(err, nil)
	if err.Message != "plain message, nothing resolved" {
		t.Errorf("Message = %q, want unchanged", err.Message)
	}
}

// TestGrpcHasAnyReference is the short-circuit's own small table — the same "is there anything to
// resolve at all" gate apivars' own referencedFields walk exists for.
func TestGrpcHasAnyReference(t *testing.T) {
	cases := []struct {
		name     string
		target   string
		metadata []grpcclient.MetaPair
		message  string
		want     bool
	}{
		{name: "nothing", target: "api.example.com:443", message: `{"a":1}`, want: false},
		{name: "target reference", target: "{{host}}:443", want: true},
		{name: "metadata name reference", metadata: []grpcclient.MetaPair{{Name: "{{headerName}}", Value: "v"}}, want: true},
		{name: "metadata value reference", metadata: []grpcclient.MetaPair{{Name: "authorization", Value: "Bearer {{token}}"}}, want: true},
		{name: "message reference", message: `{"token":"{{token}}"}`, want: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := grpcHasAnyReference(c.target, c.metadata, c.message)
			if got != c.want {
				t.Errorf("grpcHasAnyReference(%q, %+v, %q) = %v, want %v", c.target, c.metadata, c.message, got, c.want)
			}
		})
	}
}

// newGrpcServiceForTest opens a real (tmpfile-backed) SQLite database through the real migrations
// and wires a *GrpcService against it — mirrors apivars/resolve_test.go's own newResolveService
// and bridge/http_test.go's own newRepos-backed setup.
func newGrpcServiceForTest(t *testing.T) (*GrpcService, *storage.DB, *repos.VariablesRepo, *repos.CollectionsRepo) {
	t.Helper()
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	repositories, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	cipher := secrets.New()
	variablesRepo := repos.NewVariables(db.DB, cipher)
	repositories.Variables = variablesRepo
	apiVars := apivars.New(variablesRepo, cipher, nil)

	svc := &GrpcService{Deps: appcore.Deps{DB: db.DB, Repos: repositories, ApiVars: apiVars}}
	return svc, db, variablesRepo, repositories.Collections
}

// TestRecordGrpcHistory_NeverPersistsResolvedSecrets is the masking checklist's own
// persistence-round-trip case (D10), mirroring bridge/http_test.go's
// TestMaskSecrets_RedirectURLsFinalURLAndTimelineHopsBeforePersisting: a call's target, metadata
// and message JSON can each carry a resolved secret at the point grpcclient.Unary/ServerStream
// actually use them (§0.3's own "the reflection call... and the descriptor cache key" checklist
// rows apply the identical discipline one call earlier, in-memory only, with nothing to persist to
// round-trip in the first place) — but recordGrpcHistory is handed the UNRESOLVED args (D2's rule,
// verbatim), so what reaches grpc_call_history, read back as a raw column straight out of a real
// migrated SQLite database, must still be spelled {{name}}, never the live value.
func TestRecordGrpcHistory_NeverPersistsResolvedSecrets(t *testing.T) {
	svc, db, variablesRepo, collections := newGrpcServiceForTest(t)
	c, err := collections.CreateCollection("Probes")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	const secretToken = "sk_live_super_secret_token"
	if _, err := variablesRepo.Upsert(model.VariableScopeCollection, c.ID, "", "token", secretToken, true); err != nil {
		t.Fatalf("Upsert secret: %v", err)
	}

	// The call args as the bridge's own RunOp closure builds them before ever resolving anything —
	// still spelled {{token}}.
	args := GrpcCallArgs{
		OpID: "op1", TabID: "tab1", Streaming: false,
		DescriptorMode: "reflection", Target: "api.example.com:443",
		Service: "kira.probe.v1.Echo", Method: "Unary",
		MessageJSON:   `{"token":"{{token}}"}`,
		Metadata:      []grpcclient.MetaPair{{Name: "authorization", Value: "Bearer {{token}}"}},
		CollectionID:  c.ID,
	}
	// The CallResult as if the live call actually resolved and sent the secret — recordGrpcHistory
	// must never be handed this and must never derive persisted fields from it; passed here as the
	// call's own terminal outcome to record, exactly the shape Call's own RunOp closure produces.
	result := grpcclient.CallResult{
		Code: 0, CodeName: "OK", ElapsedMs: 5,
		Header: []grpcclient.MetaPair{{Name: "x-ok", Value: "1"}},
	}

	svc.recordGrpcHistory(args, result)

	entries, err := svc.Deps.Repos.GrpcHistory.List("tab:tab1")
	if err != nil || len(entries) != 1 {
		t.Fatalf("List(tab:tab1) = %d entries, err %v, want 1", len(entries), err)
	}

	var rawSnapshot string
	if err := db.DB.QueryRow(
		`SELECT snapshot_json FROM grpc_call_history WHERE id = ?`, entries[0].ID,
	).Scan(&rawSnapshot); err != nil {
		t.Fatalf("query snapshot_json: %v", err)
	}
	if strings.Contains(rawSnapshot, secretToken) {
		t.Fatalf("stored snapshot_json contains the raw secret — it reached kira.sqlite in plaintext:\n%s", rawSnapshot)
	}
	if !strings.Contains(rawSnapshot, "{{token}}") {
		t.Fatalf("stored snapshot_json does not contain the masked placeholder {{token}} at all:\n%s", rawSnapshot)
	}

	// The round trip survives Get too — what a viewer of this history entry actually sees later,
	// not just what was written (mirrors P10 D14's own check via response_history's Get).
	snap, err := svc.Deps.Repos.GrpcHistory.Get(entries[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if strings.Contains(snap.Message, secretToken) {
		t.Fatalf("decoded Message = %q still contains the raw secret", snap.Message)
	}
	for _, m := range snap.Metadata {
		if strings.Contains(m.Value, secretToken) {
			t.Fatalf("decoded Metadata %+v still contains the raw secret", m)
		}
	}
}
