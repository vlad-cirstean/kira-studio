package rpcstream

import (
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
)

// wireError mirrors @kira/git-ipc's WireError (rpc.ts): code and message always, kind only for
// a classified error that carries one (P1 produces none yet — gitclient.Error's own Kind is not
// surfaced onto the wire until a caller needs it; mapGitError already folds it into ipcerr's plain
// code/message).
type wireError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Kind    string `json:"kind,omitempty"`
}

// frame is every member of rpc.ts's Frame union folded into one struct — a field not
// meaningful for a given T is simply absent (omitempty on encode, ignored on decode). The union
// is small and every variant's fields are primitives-or-raw-JSON, so one struct with a `t`
// discriminant reads clearer here than eight Go types behind an interface would.
type frame struct {
	T       string          `json:"t"`
	ID      int             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *wireError      `json:"error,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Seq     int             `json:"seq,omitempty"`
	Chunk   json.RawMessage `json:"chunk,omitempty"`
	N       int             `json:"n,omitempty"`
}

type envelope struct {
	Version int   `json:"version"`
	Body    frame `json:"body"`
}

func boolPtr(b bool) *bool { return &b }

// wireErrorFrom maps a Go error into the wire shape — *ipcerr.Error (what every bound service in
// this repo already returns on failure) carries its Code/Message straight across; anything else
// folds to E_INTERNAL.
func wireErrorFrom(err error) *wireError {
	var ierr *ipcerr.Error
	if errors.As(err, &ierr) {
		return &wireError{Code: ierr.Code, Message: ierr.Message}
	}
	return &wireError{Code: "E_INTERNAL", Message: err.Error()}
}
