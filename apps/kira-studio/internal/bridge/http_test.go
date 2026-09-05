package bridge

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// TestMaskSecrets_RedirectURLsFinalURLAndTimelineHopsBeforePersisting is P10 D14/F16's own
// security assertion — not a CRUD round trip — the same posture P9's own masking commit took for
// header/body masking (tests/ui/http-raw.spec.ts's "N secret values are shown as {{name}}" case).
//
// F16 found that Response.Redirects[].URL and Response.FinalURL — resolved URLs, P2 fields — have
// been persisted to kira.sqlite unmasked since P8 landed, and that this phase's own per-hop
// Timeline URL/header list would widen the same gap. This proves the fix at the exact point it
// runs (maskSecrets), then proves it end to end through the real path a live send actually takes:
// mask, then Record, then read the raw snapshot_json column back out of a real, migrated SQLite
// database — the secret's plaintext must appear in neither, the same way
// TestResponseHistoryRecordStripsWireBeforePersisting (response_history_test.go) proves Wire never
// reaches the column at all.
func TestMaskSecrets_RedirectURLsFinalURLAndTimelineHopsBeforePersisting(t *testing.T) {
	const secret = "sk_live_super_secret_token"
	const masked = "{{apiKey}}"
	usedSecrets := map[string]string{"apiKey": secret}

	resp := httpclient.Response{
		Status: 200, StatusText: "OK", Proto: "HTTP/1.1",
		FinalURL: "https://api.example.com/orders/final?token=" + secret,
		Redirects: []httpclient.RedirectHop{
			{Status: 301, URL: "https://api.example.com/orders?token=" + secret},
		},
		Timeline: httpclient.Timeline{
			Hops: []httpclient.TimelineHop{
				{
					Index: 0, Method: "GET",
					URL:    "https://api.example.com/orders?token=" + secret,
					Status: 301,
					Headers: []httpclient.Header{
						// F16: a redirect's own Location header is a URL too, and the most likely
						// place for a secret-bearing query string to reappear.
						{Name: "Location", Value: "https://api.example.com/orders/final?token=" + secret},
					},
				},
				{Index: 1, Method: "GET", URL: "https://api.example.com/orders/final?token=" + secret, Status: 200},
			},
			TotalMs: 12,
		},
	}

	maskSecrets(&resp, usedSecrets)

	assertMasked := func(t *testing.T, label, s string) {
		t.Helper()
		if strings.Contains(s, secret) {
			t.Errorf("%s = %q still contains the raw secret", label, s)
		}
		if !strings.Contains(s, masked) {
			t.Errorf("%s = %q, want it to contain %q", label, s, masked)
		}
	}
	assertMasked(t, "FinalURL", resp.FinalURL)
	assertMasked(t, "Redirects[0].URL", resp.Redirects[0].URL)
	assertMasked(t, "Timeline.Hops[0].URL", resp.Timeline.Hops[0].URL)
	assertMasked(t, "Timeline.Hops[1].URL", resp.Timeline.Hops[1].URL)
	assertMasked(t, "Timeline.Hops[0].Headers[0].Value (Location)", resp.Timeline.Hops[0].Headers[0].Value)

	// The real persistence path: Send (http.go) calls maskSecrets before ResponseHistory.Record on
	// every send — reproduced here against a real migrated SQLite database (storage.Open(), the
	// same helper repos_test.go's own newRepos wraps) rather than a fixture, so a future refactor
	// that changes the schema or the marshalling would still be caught.
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	historyRepo := &repos.ResponseHistoryRepo{DB: db.DB}
	if err := historyRepo.Record(model.ResponseHistoryRecord{
		TabID: "tab1", Method: "GET", URL: "https://api.example.com/orders",
		Headers: []httpclient.Header{}, Body: httpclient.Body{Mode: "none"},
		Response: resp,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := historyRepo.List("tab:tab1")
	if err != nil || len(entries) != 1 {
		t.Fatalf("List(tab:tab1) = %d entries, err %v, want 1", len(entries), err)
	}

	var rawSnapshot string
	if err := db.DB.QueryRow(
		`SELECT snapshot_json FROM api_response_history WHERE id = ?`, entries[0].ID,
	).Scan(&rawSnapshot); err != nil {
		t.Fatalf("query snapshot_json: %v", err)
	}
	if strings.Contains(rawSnapshot, secret) {
		t.Fatalf("stored snapshot_json contains the raw secret — it reached kira.sqlite in plaintext:\n%s", rawSnapshot)
	}
	if !strings.Contains(rawSnapshot, masked) {
		t.Fatalf("stored snapshot_json does not contain the masked placeholder %q at all:\n%s", masked, rawSnapshot)
	}

	// D10: the timeline itself survives the round trip (unlike Wire, P9 D7) — confirming the
	// masked values are what a viewer of this history entry actually sees later, not just what was
	// written.
	snap, err := historyRepo.Get(entries[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(snap.Response.Timeline.Hops) != 2 {
		t.Fatalf("decoded Timeline.Hops = %d entries, want 2", len(snap.Response.Timeline.Hops))
	}
	assertMasked(t, "decoded Timeline.Hops[0].URL", snap.Response.Timeline.Hops[0].URL)
	assertMasked(t, "decoded FinalURL", snap.Response.FinalURL)
}

// TestMaskSendErrTimeline_MasksFailedSendHopURL is D14's reach into D15's own new failure
// channel: mapHttpError marshals herr.Timeline into ipcerr.Error.Details — a copyable surface,
// per §0.3 — so a failed send's own hop URL must be masked before that happens too, not only a
// successful one's.
func TestMaskSendErrTimeline_MasksFailedSendHopURL(t *testing.T) {
	const secret = "sk_live_super_secret_token"
	usedSecrets := map[string]string{"apiKey": secret}

	sendErr := &httpclient.Error{
		Code: httpclient.CodeHTTPTransport, Message: "connect: connection refused",
		Timeline: &httpclient.Timeline{
			Hops: []httpclient.TimelineHop{
				{Index: 0, Method: "GET", URL: "https://api.example.com/orders?token=" + secret},
			},
		},
	}

	maskSendErrTimeline(sendErr, usedSecrets)

	got := sendErr.Timeline.Hops[0].URL
	if strings.Contains(got, secret) {
		t.Fatalf("Timeline.Hops[0].URL = %q still contains the raw secret", got)
	}
	if !strings.Contains(got, "{{apiKey}}") {
		t.Fatalf("Timeline.Hops[0].URL = %q, want it masked to {{apiKey}}", got)
	}
}

// TestMaskSendErrTimeline_MasksMessageForTransportAndBadURLErrors is finding 1 of the round-1
// review: client.go's classifySendErr (transport failure) and resolveURL (bad-URL-parse failure)
// both build herr.Message from the *resolved* URL — net/http's own *url.Error and url.Parse's own
// error both embed the URL they were given verbatim — yet maskSendErrTimeline used to touch only
// herr.Timeline.Hops[].URL, never herr.Message itself. A bad-URL-parse failure in particular has no
// Timeline at all (it fails before classifySendErr ever runs), so that path went entirely
// unmasked. Both shapes are covered here since gRPC's own mapHttpError/RunOp.Error() reads
// herr.Message verbatim either way.
func TestMaskSendErrTimeline_MasksMessageForTransportAndBadURLErrors(t *testing.T) {
	const secret = "sk_live_super_secret_token"
	usedSecrets := map[string]string{"apiKey": secret}

	cases := []struct {
		name string
		err  *httpclient.Error
	}{
		{
			name: "transport error (has a Timeline)",
			err: &httpclient.Error{
				Code:    httpclient.CodeHTTPTransport,
				Message: `Get "https://api.example.com/orders?token=` + secret + `": dial tcp: connection refused`,
				Timeline: &httpclient.Timeline{
					Hops: []httpclient.TimelineHop{{Index: 0, Method: "GET", URL: "https://api.example.com/orders?token=" + secret}},
				},
			},
		},
		{
			name: "bad-request URL-parse error (no Timeline yet)",
			err: &httpclient.Error{
				Code:    httpclient.CodeBadRequest,
				Message: `invalid URL: parse "https://api.example.com/orders?token=` + secret + `\x7f": net/url: invalid control character in URL`,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			maskSendErrTimeline(tc.err, usedSecrets)
			if strings.Contains(tc.err.Message, secret) {
				t.Fatalf("Message = %q still contains the raw secret", tc.err.Message)
			}
			if !strings.Contains(tc.err.Message, "{{apiKey}}") {
				t.Fatalf("Message = %q, want it masked to {{apiKey}}", tc.err.Message)
			}

			// mapHttpError marshals herr.Message straight into ipcerr.Error.Message — the value
			// control.ts unwraps and the renderer can copy — so it must never carry the secret.
			mapped := mapHttpError(tc.err)
			if strings.Contains(mapped.Error(), secret) {
				t.Fatalf("mapHttpError(...).Error() = %q still contains the raw secret", mapped.Error())
			}
		})
	}
}

// TestHttpSendFailure_OpLogErrorNeverContainsSecret proves finding 1 end to end, through the exact
// path a live failed send takes: RunOp's own err.Error() (host.go) is persisted verbatim to
// op_log.error by oplog's Wiring — reproduced here against a real Host and a real, migrated SQLite
// database (storage.Open(), the same helper the redirect/timeline masking test above uses) rather
// than calling maskSendErrTimeline in isolation, so a future refactor of RunOp's own error-handling
// would still be caught.
func TestHttpSendFailure_OpLogErrorNeverContainsSecret(t *testing.T) {
	const secret = "sk_live_super_secret_token"
	usedSecrets := map[string]string{"apiKey": secret}

	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	opsRepo := &repos.OpsRepo{DB: db.DB}
	host := adapterhost.NewHost(adapters.Deps{}, nil)
	wiring := oplog.New(host, opsRepo, 30)

	done := make(chan model.OpRecord, 4)
	unsubscribe := wiring.OnUpdate(func(rec model.OpRecord) {
		if rec.Status != "running" {
			done <- rec
		}
	})
	defer unsubscribe()

	wiring.Start()
	defer wiring.Stop()

	tabID := "tab1"
	spec := adapterhost.OpSpec{OpID: "op-http-fail", Kind: "http", TabID: &tabID}
	_, _, runErr := host.RunOp(context.Background(), spec,
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			// The exact shape bridge/http.go's Send closure produces for a transport failure whose
			// message embeds the resolved (secret-bearing) URL, masked exactly as that closure now
			// does before returning it to RunOp.
			sendErr := &httpclient.Error{
				Code:    httpclient.CodeHTTPTransport,
				Message: `Get "https://api.example.com/orders?token=` + secret + `": dial tcp: connection refused`,
				Timeline: &httpclient.Timeline{
					Hops: []httpclient.TimelineHop{{Index: 0, Method: "GET", URL: "https://api.example.com/orders?token=" + secret}},
				},
			}
			maskSendErrTimeline(sendErr, usedSecrets)
			return nil, sendErr
		})
	if runErr == nil {
		t.Fatal("expected RunOp to return the send error")
	}
	if strings.Contains(mapHttpError(runErr).Error(), secret) {
		t.Fatalf("mapHttpError(runErr).Error() still contains the raw secret")
	}

	select {
	case rec := <-done:
		if rec.Error == nil {
			t.Fatal("op_log row has no error recorded")
		}
		if strings.Contains(*rec.Error, secret) {
			t.Fatalf("op_log.error = %q still contains the raw secret", *rec.Error)
		}
		if !strings.Contains(*rec.Error, "{{apiKey}}") {
			t.Fatalf("op_log.error = %q, want it masked to {{apiKey}}", *rec.Error)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for the op:end update")
	}

	var rawError string
	if err := db.DB.QueryRow(`SELECT error FROM op_log WHERE id = ?`, "op-http-fail").Scan(&rawError); err != nil {
		t.Fatalf("query op_log.error: %v", err)
	}
	if strings.Contains(rawError, secret) {
		t.Fatalf("stored op_log.error column contains the raw secret: %q", rawError)
	}
}

// TestMaskSecrets_MasksURLEncodedBodyDespiteQueryEscape is finding 6: secretReplacer used to build
// its strings.Replacer over each secret's own *plaintext*, but a urlencoded body's rendered wire
// text (resp.Wire.Request) is the *url.QueryEscape'd* form buildURLEncoded/encodeURLEncodedFields
// actually produced — url.QueryEscape rewrites space, '+', '@' (among others), so a secret value
// containing any of them survived masking in cleartext, right next to the pane's own "N secret
// values shown as {{name}}" claim. Driven through a real httpclient.Send (a real httptest server),
// not a hand-built Response, so a future change to how the wire text is rendered would still be
// caught here.
func TestMaskSecrets_MasksURLEncodedBodyDespiteQueryEscape(t *testing.T) {
	// Contains a space, a '+', and an '@' — three of the characters url.QueryEscape rewrites,
	// exactly the ones the finding calls out.
	const secretName = "apiKey"
	const secretValue = "p@ss word+token"
	usedSecrets := map[string]string{secretName: secretValue}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	resp, err := httpclient.Send(context.Background(), httpclient.Request{
		Method: "POST",
		URL:    srv.URL + "/x",
		Body: httpclient.Body{
			Mode:       "urlencoded",
			URLEncoded: []httpclient.Field{{Name: "token", Value: secretValue}},
		},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if resp.Wire == nil {
		t.Fatal("resp.Wire is nil — nothing to mask")
	}
	// Confirms the fixture actually exercises the bug this test guards: the encoded form must
	// differ from the plaintext, and both must be present in the unmasked wire text.
	encoded := url.QueryEscape(secretValue)
	if encoded == secretValue {
		t.Fatalf("QueryEscape(%q) = %q did not change — this fixture no longer exercises the bug", secretValue, encoded)
	}
	if !strings.Contains(resp.Wire.Request, encoded) {
		t.Fatalf("unmasked wire request does not contain the encoded secret %q at all:\n%s", encoded, resp.Wire.Request)
	}

	maskSecrets(&resp, usedSecrets)

	if strings.Contains(resp.Wire.Request, secretValue) {
		t.Fatalf("masked wire request still contains the raw secret:\n%s", resp.Wire.Request)
	}
	if strings.Contains(resp.Wire.Request, encoded) {
		t.Fatalf("masked wire request still contains the QueryEscape'd secret %q:\n%s", encoded, resp.Wire.Request)
	}
	if !strings.Contains(resp.Wire.Request, "{{apiKey}}") {
		t.Fatalf("masked wire request does not contain the masked placeholder:\n%s", resp.Wire.Request)
	}
}
