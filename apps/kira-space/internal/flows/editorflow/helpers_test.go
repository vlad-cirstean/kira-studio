package editorflow_test

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

const waitFor = 10 * time.Second

// frame is the rpcstream wire frame the editor extension speaks.
type frame struct {
	T       string          `json:"t"`
	ID      int             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *wireErr        `json:"error,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Chunk   json.RawMessage `json:"chunk,omitempty"`
	N       int             `json:"n,omitempty"`
}

type wireErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type envelope struct {
	Version int   `json:"version"`
	Body    frame `json:"body"`
}

type handshakeFrame struct {
	Kind      string `json:"kind"`
	RequestID string `json:"requestId,omitempty"`
	Token     string `json:"token,omitempty"`
}

// editor is a raw git.sock client: the framing and handshake are written here, not borrowed from
// the server, so the wire is what a real extension sees.
type editor struct {
	t    *testing.T
	nc   net.Conn
	r    *bufio.Reader
	mu   sync.Mutex
	next int
	wait map[int]chan frame
	evts []frame
	// closed closes when the read loop ends (server dropped the connection).
	closed chan struct{}
}

func sockPath(app *flowharness.App) string { return filepath.Join(app.SpaceHome, "git.sock") }

func dial(t *testing.T, app *flowharness.App) *editor {
	t.Helper()
	nc, err := net.Dial("unix", sockPath(app))
	if err != nil {
		t.Fatalf("dial git.sock: %v", err)
	}
	t.Cleanup(func() { _ = nc.Close() })
	return &editor{t: t, nc: nc, r: bufio.NewReader(nc), next: 1, wait: map[int]chan frame{}, closed: make(chan struct{})}
}

func (e *editor) write(v any) {
	e.t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		e.t.Fatal(err)
	}
	buf := make([]byte, 4+len(b))
	binary.BigEndian.PutUint32(buf, uint32(len(b)))
	copy(buf[4:], b)
	if _, err := e.nc.Write(buf); err != nil {
		e.t.Fatalf("write frame: %v", err)
	}
}

func (e *editor) read() ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(e.r, hdr[:]); err != nil {
		return nil, err
	}
	body := make([]byte, binary.BigEndian.Uint32(hdr[:]))
	_, err := io.ReadFull(e.r, body)
	return body, err
}

func (e *editor) readHandshake() (handshakeFrame, error) {
	raw, err := e.read()
	if err != nil {
		return handshakeFrame{}, err
	}
	var h handshakeFrame
	return h, json.Unmarshal(raw, &h)
}

// hello sends the hello frame; token nil starts a fresh pairing.
func (e *editor) hello(id, label string, token *string) {
	e.t.Helper()
	e.write(map[string]any{
		"kind": "hello", "protocol": gitrpc.Protocol, "contractVersion": gitrpc.ContractVersion,
		"client": map[string]any{"id": id, "label": label, "pid": os.Getpid(), "appVersion": "flow-test"},
		"token":  token,
	})
}

// handshake follows the handshake to its end: the terminal frame kind, plus the token a pairing
// issued. It starts the read loop on "ready".
func (e *editor) handshake(onPairingRequired func(requestID string)) (kind, token string) {
	e.t.Helper()
	for {
		h, err := e.readHandshake()
		if err != nil {
			e.t.Fatalf("handshake read: %v", err)
		}
		switch h.Kind {
		case "pairingRequired":
			if onPairingRequired != nil {
				onPairingRequired(h.RequestID)
			}
		case "paired":
			token = h.Token
		case "ready":
			go e.loop()
			return "ready", token
		default:
			return h.Kind, ""
		}
	}
}

func (e *editor) loop() {
	defer close(e.closed)
	for {
		raw, err := e.read()
		if err != nil {
			return
		}
		if len(raw) > 0 && raw[0] == 0x00 {
			n := binary.BigEndian.Uint32(raw[1:5])
			raw = raw[5 : 5+n]
		}
		var env envelope
		if json.Unmarshal(raw, &env) != nil {
			continue
		}
		e.mu.Lock()
		if env.Body.T == "evt" {
			e.evts = append(e.evts, env.Body)
		} else if ch := e.wait[env.Body.ID]; ch != nil {
			ch <- env.Body
		}
		e.mu.Unlock()
	}
}

func (e *editor) register() (int, chan frame) {
	e.mu.Lock()
	defer e.mu.Unlock()
	id := e.next
	e.next++
	ch := make(chan frame, 64)
	e.wait[id] = ch
	return id, ch
}

func (e *editor) send(body frame) {
	e.t.Helper()
	e.write(envelope{Version: gitrpc.ContractVersion, Body: body})
}

// call sends a request and decodes the result; a server refusal returns its code.
func (e *editor) call(method string, params, out any) (code string) {
	e.t.Helper()
	id, ch := e.register()
	p, err := json.Marshal(params)
	if err != nil {
		e.t.Fatal(err)
	}
	e.send(frame{T: "req", ID: id, Method: method, Params: p})
	select {
	case f := <-ch:
		if f.OK != nil && !*f.OK {
			return f.Error.Code
		}
		if out != nil {
			if err := json.Unmarshal(f.Result, out); err != nil {
				e.t.Fatalf("%s: decode %s: %v", method, f.Result, err)
			}
		}
		return ""
	case <-e.closed:
		return "closed"
	case <-time.After(waitFor):
		e.t.Fatalf("%s: no response", method)
		return ""
	}
}

// stream opens method, grants credit per chunk, and returns every chunk's JSON half.
func (e *editor) stream(method string, params any) []json.RawMessage {
	e.t.Helper()
	id, ch := e.register()
	p, err := json.Marshal(params)
	if err != nil {
		e.t.Fatal(err)
	}
	e.send(frame{T: "open", ID: id, Method: method, Params: p})
	e.send(frame{T: "credit", ID: id, N: 4})
	var chunks []json.RawMessage
	for {
		select {
		case f := <-ch:
			switch f.T {
			case "chunk":
				chunks = append(chunks, f.Chunk)
				e.send(frame{T: "credit", ID: id, N: 1})
			case "end":
				if f.Error != nil {
					e.t.Fatalf("%s ended with %s: %s", method, f.Error.Code, f.Error.Message)
				}
				return chunks
			}
		case <-time.After(waitFor):
			e.t.Fatalf("%s: stream stalled", method)
		}
	}
}

func (e *editor) events(method string) []frame {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []frame
	for _, f := range e.evts {
		if f.Method == method {
			out = append(out, f)
		}
	}
	return out
}

func (e *editor) dropped() bool {
	select {
	case <-e.closed:
		return true
	default:
		return false
	}
}

// pair runs a fresh pairing, approving through GitClientsService as the user would, and returns
// the session token.
func pair(t *testing.T, app *flowharness.App, id, label string) (*editor, string) {
	t.Helper()
	c := dial(t, app)
	c.hello(id, label, nil)
	kind, token := c.handshake(func(reqID string) {
		snap := app.W.GitClients.PendingPairing()
		if snap.Pending == nil || snap.Pending.RequestID != reqID {
			t.Errorf("PendingPairing = %+v, want request %s", snap, reqID)
			return
		}
		go func() {
			res, err := app.W.GitClients.Approve(bridge.GitClientsIDArgs{ID: reqID})
			if err != nil || res.Result != "resolved" {
				t.Errorf("Approve = %+v, %v", res, err)
			}
		}()
	})
	if kind != "ready" || token == "" {
		t.Fatalf("pairing ended %q token %q", kind, token)
	}
	return c, token
}

var errTimeout = errors.New("timeout")

func until(cond func() bool) error {
	deadline := time.Now().Add(waitFor)
	for time.Now().Before(deadline) {
		if cond() {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errTimeout
}
