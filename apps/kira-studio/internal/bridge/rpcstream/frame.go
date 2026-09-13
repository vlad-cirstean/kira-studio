package rpcstream

import (
	"encoding/binary"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
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

// blobFrameDiscriminant is a blob frame body's first byte (G3 plan D4) — 0x00 can never begin a
// JSON control frame (whose first byte is always '{'), so a peer that has never opened a stream
// never needs to know this byte exists at all: the handshake, app.init, repo.open, repo.close and
// repo.changed are byte-identical to what G1/G2 shipped.
const blobFrameDiscriminant = 0x00

// encodeBody marshals env as one frame's body. blob == nil produces a plain JSON body, unchanged
// from G1/G2. blob != nil produces D4's own layout instead:
//
//	0x00 | uint32BE headerLen | headerJSON | blob…to the end of the frame
//
// Exactly one blob per frame, and it is the rest of the frame — the outer length-prefixed framing
// (gitsock/frame.go, unchanged by this package) already bounds it, so no second length is
// written. Where the blob belongs *inside* the JSON payload is the payload's own business, not
// this function's: rpcstream never inspects env's contents at all, and a caller (gitrpc) marks
// the position with its own marker (commitsBlob's `{"$blob":true}`) that only socketChannel.ts's
// reader needs to recognise.
func encodeBody(env envelope, blob []byte) ([]byte, error) {
	headerJSON, err := json.Marshal(env)
	if err != nil {
		return nil, err
	}
	if blob == nil {
		return headerJSON, nil
	}
	out := make([]byte, 0, 1+4+len(headerJSON)+len(blob))
	out = append(out, blobFrameDiscriminant)
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(headerJSON)))
	out = append(out, lenBuf[:]...)
	out = append(out, headerJSON...)
	out = append(out, blob...)
	return out, nil
}

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
