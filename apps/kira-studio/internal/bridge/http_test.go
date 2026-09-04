package bridge

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
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
		`SELECT snapshot_json FROM http_response_history WHERE id = ?`, entries[0].ID,
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
