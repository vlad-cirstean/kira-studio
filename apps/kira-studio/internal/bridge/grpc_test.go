package bridge

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/grpcclient"
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
// resolve at all" gate httpvars' own referencedFields walk exists for.
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
