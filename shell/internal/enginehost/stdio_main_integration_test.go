package enginehost_test

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

// TestStdioMainRealEngineRoundTrip runs the real, bundled src/engine/stdio-main.ts under the
// real Node — the opt-in integration test P54's plan asks for. It is not a silent
// platform-skip: the bundle is the build product of a documented command ("bun run
// build:engine"), and P54's own acceptance criteria require this test to have been run green
// against it.
func TestStdioMainRealEngineRoundTrip(t *testing.T) {
	const bundle = "../../runtime/engine/engine.cjs"
	if _, err := os.Stat(bundle); err != nil {
		t.Skip(`run "bun run build:engine" first`)
	}

	h := newHost(t, bundle)

	// Control tag: engine:configure-cache's real op name is cache:configure
	// (src/shared/protocol/engine-ops.ts) and handleConfigureCache touches no adapter, no driver,
	// no database.
	if _, err := h.Call("cache:configure", map[string]any{"l2BudgetBytes": 64 * 1024 * 1024}); err != nil {
		t.Errorf("Call(cache:configure): %v", err)
	}

	// Control tag: an unknown op returns E_UNSUPPORTED with control.ts's own message shape.
	_, err := h.Call("definitely-not-a-real-op", nil)
	if err == nil {
		t.Error("Call(unknown control op) = nil error, want E_UNSUPPORTED")
	}

	// Data tag: ping returns rpc.ts's own handler payload.
	raw, err := sendAndAwaitData(t, h, "ping", nil)
	if err != nil {
		t.Fatalf("data-channel ping: %v", err)
	}
	var pong struct {
		Pong      bool `json:"pong"`
		EnginePID int  `json:"enginePid"`
	}
	if err := json.Unmarshal(raw, &pong); err != nil || !pong.Pong {
		t.Fatalf("data-channel ping payload = %s", raw)
	}
	if pong.EnginePID != h.PID() {
		t.Errorf("enginePid = %d, want %d", pong.EnginePID, h.PID())
	}

	// Data tag: an unknown op returns E_UNSUPPORTED with rpc.ts's own message shape.
	if _, err := sendAndAwaitData(t, h, "definitely-not-a-real-op", nil); err == nil {
		t.Error("data-channel unknown op = nil error, want E_UNSUPPORTED")
	}
}

// sendAndAwaitData sends one JSON-RPC request over the data channel via SendData and waits for
// its matching response through an attached Sink — exercising the real tag-1 dispatch path, not
// the control-channel Call helper.
func sendAndAwaitData(t *testing.T, h *enginehost.Host, op string, payload any) (json.RawMessage, error) {
	t.Helper()
	const id = 999

	type result struct {
		payload json.RawMessage
		err     error
	}
	got := make(chan result, 1)
	detach := h.AttachStream(sinkFunc(func(frame []byte) error {
		var resp struct {
			ID      int             `json:"id"`
			OK      bool            `json:"ok"`
			Payload json.RawMessage `json:"payload"`
			Error   *struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(frame, &resp); err != nil || resp.ID != id {
			return nil // not ours (or noise); ignore
		}
		if !resp.OK {
			got <- result{err: errOf(resp.Error.Code, resp.Error.Message)}
		} else {
			got <- result{payload: resp.Payload}
		}
		return nil
	}))
	defer detach()

	req, err := json.Marshal(map[string]any{"kind": "req", "id": id, "op": op, "payload": payload})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	if err := h.SendData(req); err != nil {
		t.Fatalf("SendData: %v", err)
	}

	select {
	case r := <-got:
		return r.payload, r.err
	case <-time.After(10 * time.Second):
		t.Fatal("no data-channel response within 10s")
		return nil, nil
	}
}

type sinkFunc func(frame []byte) error

func (f sinkFunc) Send(frame []byte) error { return f(frame) }

type wireError struct{ code, message string }

func (e *wireError) Error() string { return e.code + ": " + e.message }

func errOf(code, message string) error { return &wireError{code: code, message: message} }
