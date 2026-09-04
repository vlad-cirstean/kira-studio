package bridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
)

// HttpService is P2's one new bound service: a single outbound HTTP request run through the
// *existing* op scheduler the DB adapters already use (D3) — no new scheduler, no new op log,
// no new cancel path.
type HttpService struct {
	Deps appcore.Deps
}

// HttpSendArgs carries httpclient.Request's fields plus the op-log addressing every op needs
// (OpID minted by the renderer, exactly as every data-plane op's already is — F16; TabID so the
// Operations panel can resolve a tab column for a connectionless op, F9).
type HttpSendArgs struct {
	OpID    string              `json:"opId"`
	TabID   string              `json:"tabId"`
	Method  string              `json:"method"`
	URL     string              `json:"url"`
	Headers []httpclient.Header `json:"headers"`
	Body    string              `json:"body"`
	HasBody bool                `json:"hasBody"`
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
			op.SetCommand(fmt.Sprintf("%s %s", args.Method, args.URL))
			resp, sendErr := httpclient.Send(runCtx, httpclient.Request{
				Method:  args.Method,
				URL:     args.URL,
				Headers: args.Headers,
				Body:    args.Body,
				HasBody: args.HasBody,
			})
			if sendErr != nil {
				return nil, sendErr
			}
			op.SetCommand(fmt.Sprintf("%s %s → %d %s", args.Method, args.URL, resp.Status, resp.StatusText))
			return resp, nil
		})
	if err != nil {
		return httpclient.Response{}, mapHttpError(err)
	}
	resp, _ := value.(httpclient.Response)
	return resp, nil
}

// mapHttpError joins httpclient's own four-code vocabulary into the ipcerr family (D8) — not
// adapters.ErrorCode, whose CodeConnect/CodeEngineDown views/shared/viewOp.ts's
// DISCONNECTED_CODES would misread as "the database connection is gone" and pop a Reconnect gate
// over a tab that has no connection to reconnect.
func mapHttpError(err error) error {
	var herr *httpclient.Error
	if errors.As(err, &herr) {
		return ipcerr.New(string(herr.Code), herr.Message)
	}
	return ipcerr.Internal(err.Error())
}
