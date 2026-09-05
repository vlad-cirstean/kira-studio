package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// HttpService is P2's one new bound service: a single outbound HTTP request run through the
// *existing* op scheduler the DB adapters already use (D3) — no new scheduler, no new op log,
// no new cancel path.
type HttpService struct {
	Deps appcore.Deps
}

// HttpSendArgs carries httpclient.Request's fields plus the op-log addressing every op needs
// (OpID minted by the renderer, exactly as every data-plane op's already is — F16; TabID so the
// Operations panel can resolve a tab column for a connectionless op, F9). CollectionID/
// EnvironmentID are P5 D6's own addition — both possibly empty (a scratch tab has no collection;
// no environment may be selected) — and are used for exactly one thing: naming the scope stage 2
// resolves secrets against.
type HttpSendArgs struct {
	OpID          string              `json:"opId"`
	TabID         string              `json:"tabId"`
	Method        string              `json:"method"`
	URL           string              `json:"url"`
	Headers       []httpclient.Header `json:"headers"`
	Body          httpclient.Body     `json:"body"`
	CollectionID  string              `json:"collectionId"`
	EnvironmentID string              `json:"environmentId"`
	// ItemID is P8 D2's own addition: the saved request this tab is bound to, or "" for a
	// scratch tab — supplied by state.ts's send() as tab.state.itemId ?? '' (the tab already
	// knows it, http.ts:208), and used for exactly one thing, recording a response-history
	// entry under the right scope.
	ItemID string `json:"itemId"`
}

// Send runs one HTTP request through Host.RunOp with ConnectionID: nil (D3, proven safe by F10 —
// both connection-dependent branches in RunOp/CancelOp already self-guard on a nil connection
// id). ctx is Wails-injected (the method's first parameter is context.Context, bindings.go's
// needsContext), so closing the window mid-request aborts it via CancelWindowCalls; RunOp derives
// its own cancellable context from it, which is what the Stop button's opsCancel path (the app's
// existing cancel mechanism, not Wails' own $CancellablePromise, per F11/D3) actually cancels.
//
// A non-2xx response is not a Go error, so RunOp naturally logs it 'ok' — the op is the exchange,
// and a 404 is what testing an endpoint is for (D3). op.SetCommand carries the human-readable
// outcome for the Operations panel: the method+URL before send, overwritten with "→ status text"
// once the response is known.
func (s *HttpService) Send(ctx context.Context, args HttpSendArgs) (httpclient.Response, error) {
	if args.OpID == "" {
		return httpclient.Response{}, ipcerr.BadRequest("opId is required")
	}
	if args.TabID == "" {
		return httpclient.Response{}, ipcerr.BadRequest("tabId is required")
	}

	tabID := args.TabID
	spec := adapterhost.OpSpec{ConnectionID: nil, Kind: "http", OpID: args.OpID, TabID: &tabID}

	_, value, err := s.Deps.Router.Host().RunOp(ctx, spec,
		func(runCtx context.Context, op *adapters.OpCtx) (any, error) {
			// P5 D6/F3: op.SetCommand is called with the *unresolved* URL, both times — op_log.
			// command is a persisted SQLite column rendered in the Operations panel, and a
			// {{token}} in a URL is exactly the kind of thing a user puts a credential in.
			// Resolving secrets before this line would write a plaintext credential into
			// kira.sqlite on every send.
			op.SetCommand(fmt.Sprintf("%s %s", args.Method, args.URL))

			// Stage 2 (D6): secrets enter here and go no further — resolved.URL/Headers/Body are
			// handed straight to httpclient.Send and never fed back into anything logged.
			url, headers, body, usedSecrets, resolveErr := s.Deps.ApiVars.ResolveRequest(
				args.URL, args.Headers, args.Body, args.CollectionID, args.EnvironmentID,
			)
			if resolveErr != nil {
				return nil, resolveErr
			}

			resp, sendErr := httpclient.Send(runCtx, httpclient.Request{
				Method:  args.Method,
				URL:     url,
				Headers: headers,
				Body:    body,
			})
			if sendErr != nil {
				// P10 D14/D15: a failed send's own Timeline (classifySendErr always attaches one,
				// C2) carries the same resolved hop URLs a successful send's does, and mapHttpError
				// — outside this closure, past where usedSecrets goes out of scope — is what turns
				// it into ipcerr.Error.Details, a copyable surface. Masked here, the one place that
				// still has usedSecrets, rather than never masked at all.
				maskSendErrTimeline(sendErr, usedSecrets)
				return nil, sendErr
			}
			op.SetCommand(fmt.Sprintf("%s %s → %d %s", args.Method, args.URL, resp.Status, resp.StatusText))

			// P9 D6, widened by P10 D14/F16: the rendered exchange, the timeline's hop URLs and
			// hop headers, and Redirects/FinalURL are all built from the *resolved* request or a
			// resolved redirect chain, so every one of them carries a secret's plaintext — the
			// exact situation P7 D10 already ruled on for a generated curl command (a copyable
			// text surface), and F16 found that Redirects[].URL/FinalURL have been persisted to
			// kira.sqlite unmasked since P8 landed. Masked here, at the point the values are
			// already known, rather than inventing a second reveal gate (OQ-4): a secret's
			// plaintext must never reach a copyable surface ungated, nor kira.sqlite outside
			// api_variables.secret_value (§0.3).
			maskSecrets(&resp, usedSecrets)

			// P8 D2: recorded from args (stage 1 — F3), never from resolved. Best-effort: a
			// failed insert logs and the send still returns its response — a history feature
			// must never be the reason a user loses the answer they were waiting for.
			if err := s.Deps.Repos.ResponseHistory.Record(model.ResponseHistoryRecord{
				ItemID:        args.ItemID,
				TabID:         args.TabID,
				EnvironmentID: args.EnvironmentID,
				Method:        args.Method,
				URL:           args.URL,
				Headers:       args.Headers,
				Body:          args.Body,
				Response:      resp,
			}); err != nil {
				slog.Warn("recording response history failed", "scope", "bridge/http", "opId", args.OpID, "err", err)
			}

			return resp, nil
		})
	if err != nil {
		return httpclient.Response{}, mapHttpError(err)
	}
	resp, _ := value.(httpclient.Response)
	return resp, nil
}

// secretReplacer builds P9 D6's own strings.Replacer over every non-empty secret value — nil when
// there is nothing to mask (no secret was actually substituted). A strings.Replacer can only
// over-mask (a secret value that happens to occur elsewhere is masked too) and never under-mask a
// surface that carries the secret's own plaintext verbatim — D6's own stated property, which does
// not by itself cover a surface that carries a *re-encoded* form instead: a urlencoded body's
// rendered wire text is url.QueryEscape's own output (finding 6, round 1), never the plaintext
// buildURLEncoded started from, and a secret used in a URL *path* segment is url.PathEscape's own
// output instead (finding 4, round 2) — PathEscape differs from QueryEscape for several
// characters (a space becomes %20 via PathEscape, + via QueryEscape). Both re-encoded forms are
// registered as additional pairs below, alongside the plaintext one.
func secretReplacer(usedSecrets map[string]string) *strings.Replacer {
	if len(usedSecrets) == 0 {
		return nil
	}
	pairs := make([]string, 0, len(usedSecrets)*4)
	for name, value := range usedSecrets {
		if value == "" {
			continue
		}
		placeholder := "{{" + name + "}}"
		pairs = append(pairs, value, placeholder)
		// F: url.QueryEscape rewrites space/+//=&%@: and non-ASCII — most real passwords and any
		// base64 token — so a urlencoded body's rendered wire text (encodeURLEncodedFields' own
		// output, wire.go's renderRequestBody) would otherwise carry the secret in cleartext,
		// just percent-encoded, with the pane still claiming "N secret values shown as {{name}}".
		if encoded := url.QueryEscape(value); encoded != value {
			pairs = append(pairs, encoded, placeholder)
		}
		// Round-2 review finding 4: a secret used in a URL *path* segment (e.g.
		// https://api.example.com/{{secret}}/orders) is percent-encoded via url.PathEscape /
		// EscapedPath(), which differs from QueryEscape for several characters (a space becomes
		// %20 via PathEscape but + via QueryEscape) — that form isn't covered by the QueryEscape
		// pair above and leaked in FinalURL, Timeline.Hops[].URL and Wire.Request's request line.
		if encoded := url.PathEscape(value); encoded != value {
			pairs = append(pairs, encoded, placeholder)
		}
	}
	if len(pairs) == 0 {
		return nil
	}
	return strings.NewReplacer(pairs...)
}

// maskSecrets is P9 D6, widened by P10 D14/F16 to four fields instead of one. F16 found that
// resp.Redirects[].URL and resp.FinalURL — P2 fields, persisted by P8 since it landed — are
// resolved URLs already reaching kira.sqlite unmasked today, and that this phase's own per-hop
// URL/header list would widen the same gap rather than open a new one. All four are masked here,
// at the point the values are already known, rather than inventing a second reveal gate (OQ-4).
// A no-op when there is no rendered exchange (a dump error, D2) or no secret was actually
// substituted.
func maskSecrets(resp *httpclient.Response, usedSecrets map[string]string) {
	replacer := secretReplacer(usedSecrets)
	if replacer == nil {
		return
	}
	if resp.Wire != nil {
		resp.Wire.Request = replacer.Replace(resp.Wire.Request)
		resp.Wire.MaskedSecrets = len(usedSecrets)
	}
	for i := range resp.Timeline.Hops {
		resp.Timeline.Hops[i].URL = replacer.Replace(resp.Timeline.Hops[i].URL)
		for j := range resp.Timeline.Hops[i].Headers {
			// F16: a Location header is a URL too — the most likely place for a secret-bearing
			// query string to reappear on a redirect.
			resp.Timeline.Hops[i].Headers[j].Value = replacer.Replace(resp.Timeline.Hops[i].Headers[j].Value)
		}
	}
	for i := range resp.Redirects {
		resp.Redirects[i].URL = replacer.Replace(resp.Redirects[i].URL)
	}
	resp.FinalURL = replacer.Replace(resp.FinalURL)
}

// maskSendErrTimeline is D14's reach into D15's own new failure channel: a failed send's Timeline
// (herr.Timeline, attached by classifySendErr for a transport failure) carries the same resolved
// hop URLs a successful send's Response.Timeline does, and mapHttpError below — called outside
// this function's caller's closure, past where usedSecrets is in scope — is what turns it into
// ipcerr.Error.Details, a copyable surface. herr.Message itself is masked too: both
// classifySendErr's transport-error path (client.go's err.Error() wraps the dialed, i.e. resolved,
// URL) and resolveURL's bad-URL-parse-error path (client.go:159, raised before a Timeline even
// exists) can embed the resolved URL straight into the message net/http or url.Parse produced —
// exactly the message RunOp's own err.Error() persists verbatim to op_log.error (host.go). A
// no-op when err is not an *httpclient.Error or no secret was actually substituted.
//
// Round-2 review finding 3: this used to mask only Hops[i].URL, unlike maskSecrets' success path
// which additionally masks Hops[i].Headers[j].Value (e.g. a Location header carrying a
// secret-bearing redirect URL) — those two fields need the exact same treatment here. Separately,
// httpclient/timeline.go's finishFailed writes a *second*, independent copy of the resolved URL
// into Hops[i].Error via err.Error(), a field masking herr.Message alone never reaches since it is
// a wholly different field. Both are rendered by TimelinePane.vue for a failed send (the
// failed-hop chip and the "Response headers" disclosure), so both are masked here too.
func maskSendErrTimeline(err error, usedSecrets map[string]string) {
	var herr *httpclient.Error
	if !errors.As(err, &herr) {
		return
	}
	replacer := secretReplacer(usedSecrets)
	if replacer == nil {
		return
	}
	herr.Message = replacer.Replace(herr.Message)
	if herr.Timeline == nil {
		return
	}
	for i := range herr.Timeline.Hops {
		herr.Timeline.Hops[i].URL = replacer.Replace(herr.Timeline.Hops[i].URL)
		herr.Timeline.Hops[i].Error = replacer.Replace(herr.Timeline.Hops[i].Error)
		for j := range herr.Timeline.Hops[i].Headers {
			herr.Timeline.Hops[i].Headers[j].Value = replacer.Replace(herr.Timeline.Hops[i].Headers[j].Value)
		}
	}
}

// mapHttpError joins httpclient's own four-code vocabulary into the ipcerr family (D8) — not
// adapters.ErrorCode, whose CodeConnect/CodeEngineDown views/shared/viewOp.ts's
// DISCONNECTED_CODES would misread as "the database connection is gone" and pop a Reconnect gate
// over a tab that has no connection to reconnect. P10 D15: when the failure carries a Timeline —
// already masked by maskSendErrTimeline above, before the error ever left the RunOp closure — it
// is marshalled into Details for a renderer that knows how to read it (control.ts/state.ts, C5).
func mapHttpError(err error) error {
	var herr *httpclient.Error
	if errors.As(err, &herr) {
		e := ipcerr.New(string(herr.Code), herr.Message)
		if herr.Timeline != nil {
			if b, mErr := json.Marshal(herr.Timeline); mErr == nil {
				e.Details = b
			} else {
				slog.Warn("marshalling failed-send timeline failed", "scope", "bridge/http", "err", mErr)
			}
		}
		return e
	}
	return ipcerr.Internal(err.Error())
}
