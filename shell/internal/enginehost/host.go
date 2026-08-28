// Package enginehost is the Go side of the Go<->Node engine transport: spawner, length-prefixed
// framer, pending-call map, event fan-out. Go analogue of src/main/engine-host.ts, shaped after
// docs/v1/plans/p51-spike-artifacts/gonode/main.go (P51 §3.3, re-validated on real macOS in
// part 4). For M1's walking skeleton the engine child answers exactly one op, "ping" — it does
// not load src/engine, which P51 §2.2 already measured separately.
package enginehost

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

const DefaultTimeout = 30 * time.Second

type portRequest struct {
	Kind    string `json:"kind"`
	ID      int    `json:"id"`
	Op      string `json:"op"`
	Payload any    `json:"payload,omitempty"`
}

type portError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

type portResponse struct {
	Kind    string          `json:"kind"`
	ID      int             `json:"id"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   *portError      `json:"error,omitempty"`
}

type portEvent struct {
	Kind    string          `json:"kind"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

// Host is the Go analogue of src/main/engine-host.ts: spawns the vendored Node runtime running
// the engine's entry script, and speaks the length-prefixed PortRequest/PortResponse/PortEvent
// framing over its stdin/stdout.
type Host struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	mu       sync.Mutex
	pending  map[int]chan portResponse
	nextID   int
	events   chan portEvent
	down     chan struct{}
	downOnce sync.Once
}

// Start spawns nodeBin running script, with execArgv-equivalent flags (e.g.
// --max-old-space-size=<engineMemoryCapMb>) passed as extra Node arguments before the script
// path, matching today's advanced.engineMemoryCapMb behaviour (P51 §3.6).
func Start(nodeBin, script string, nodeArgs ...string) (*Host, error) {
	args := append(append([]string{}, nodeArgs...), script)
	cmd := exec.Command(nodeBin, args...)
	cmd.Stderr = os.Stderr // P52 §7.3: pumped into logging under scope "engine" once M1's logger lands.

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("enginehost: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("enginehost: stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("enginehost: start %s: %w", nodeBin, err)
	}

	h := &Host{
		cmd:     cmd,
		stdin:   stdin,
		pending: make(map[int]chan portResponse),
		events:  make(chan portEvent, 16),
		down:    make(chan struct{}),
	}
	go h.readLoop(stdout)
	go h.waitAndFail()
	return h, nil
}

// waitAndFail mirrors today's E_ENGINE_DOWN policy (no auto-respawn, P1 §13.2 unchanged): on
// child exit, every pending call fails and the down channel closes for callers watching for it.
func (h *Host) waitAndFail() {
	_ = h.cmd.Wait()
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, ch := range h.pending {
		ch <- portResponse{Kind: "res", ID: id, OK: false, Error: &portError{
			Message: "engine exited", Code: "E_ENGINE_DOWN",
		}}
		delete(h.pending, id)
	}
	close(h.events)
	h.downOnce.Do(func() { close(h.down) })
}

func (h *Host) readLoop(stdout io.ReadCloser) {
	r := bufio.NewReader(stdout)
	for {
		var lenBuf [4]byte
		if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
			return
		}
		n := binary.BigEndian.Uint32(lenBuf[:])
		frame := make([]byte, n)
		if _, err := io.ReadFull(r, frame); err != nil {
			return
		}

		var probe struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(frame, &probe); err != nil {
			continue
		}
		switch probe.Kind {
		case "res":
			var resp portResponse
			if err := json.Unmarshal(frame, &resp); err != nil {
				continue
			}
			h.mu.Lock()
			if ch, ok := h.pending[resp.ID]; ok {
				ch <- resp
				delete(h.pending, resp.ID)
			}
			h.mu.Unlock()
		case "evt":
			var evt portEvent
			if err := json.Unmarshal(frame, &evt); err != nil {
				continue
			}
			select {
			case h.events <- evt:
			default: // bounded fan-out buffer; a stalled consumer never blocks the read loop.
			}
		}
	}
}

func (h *Host) writeFrame(v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(body)))
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, err := h.stdin.Write(lenBuf[:]); err != nil {
		return err
	}
	_, err = h.stdin.Write(body)
	return err
}

// Call sends one request and blocks for its matching response or timeout, exactly as
// engine-host.ts's Call does over process.parentPort today.
func (h *Host) Call(op string, payload any, timeout time.Duration) (json.RawMessage, error) {
	h.mu.Lock()
	h.nextID++
	id := h.nextID
	ch := make(chan portResponse, 1)
	h.pending[id] = ch
	h.mu.Unlock()

	if err := h.writeFrame(portRequest{Kind: "req", ID: id, Op: op, Payload: payload}); err != nil {
		h.mu.Lock()
		delete(h.pending, id)
		h.mu.Unlock()
		return nil, fmt.Errorf("enginehost: write %q: %w", op, err)
	}

	select {
	case resp := <-ch:
		if !resp.OK {
			return nil, fmt.Errorf("[%s] %s", resp.Error.Code, resp.Error.Message)
		}
		return resp.Payload, nil
	case <-time.After(timeout):
		h.mu.Lock()
		delete(h.pending, id)
		h.mu.Unlock()
		return nil, fmt.Errorf("enginehost: call %q timed out after %s", op, timeout)
	}
}

// Events returns the unsolicited PortEvent topic/payload fan-out channel, closed once the child
// exits.
func (h *Host) Events() <-chan struct {
	Topic   string
	Payload json.RawMessage
} {
	out := make(chan struct {
		Topic   string
		Payload json.RawMessage
	})
	go func() {
		defer close(out)
		for evt := range h.events {
			out <- struct {
				Topic   string
				Payload json.RawMessage
			}{Topic: evt.Topic, Payload: evt.Payload}
		}
	}()
	return out
}

// Down closes once the child has exited — the same "no auto-respawn" moment that fails every
// pending call with E_ENGINE_DOWN.
func (h *Host) Down() <-chan struct{} { return h.down }

// Alive reports whether the child process has not yet exited.
func (h *Host) Alive() bool {
	select {
	case <-h.down:
		return false
	default:
		return true
	}
}

// PID returns the engine child's process id.
func (h *Host) PID() int {
	if h.cmd.Process == nil {
		return 0
	}
	return h.cmd.Process.Pid
}

// Stop terminates the engine child. Used from OnShutdown; a live child left running past app
// exit would be a real bug, not a cosmetic one.
func (h *Host) Stop() {
	if h.cmd.Process != nil {
		_ = h.cmd.Process.Kill()
	}
}
