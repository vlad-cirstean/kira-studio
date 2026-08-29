// Package enginehost is the Go side of the Go<->Node engine transport: spawner, tagged
// length-prefixed framer, pending-call map, event fan-out, bulk-data Stream plumbing. Go analogue
// of src/main/engine-host.ts, shaped after docs/v1/plans/p51-spike-artifacts/gonode/main.go
// (P51 §3.3, re-validated on real macOS in part 4) and P52 §7.2/§7.3, sequenced for real in P54.
package enginehost

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
)

// DefaultTimeout and ConnectTimeout mirror src/main/engine-host.ts's DEFAULT_TIMEOUT_MS (30s,
// every call site but two) and the 20s override src/main/connections.ts uses for ENGINE_OP.connect
// (:191) and ENGINE_OP.test (:345).
const (
	DefaultTimeout = 30 * time.Second
	ConnectTimeout = 20 * time.Second
)

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

// Event is the Go-side shape of an unsolicited engine event, delivered to every Subscribe()r.
type Event struct {
	Topic   string
	Payload json.RawMessage
}

// EventEngineDown mirrors engine-host.ts's engine:down — published once, as each subscriber's
// last event, when the engine child exits (no auto-respawn, P1 §13.2, unchanged).
const EventEngineDown = "engine:down"

// Host is the Go analogue of src/main/engine-host.ts: spawns the vendored Node runtime running
// the engine's entry script, and speaks the tagged, length-prefixed PortRequest/PortResponse/
// PortEvent framing (frame.go) over its stdin/stdout.
type Host struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser

	// writeMu guards stdin writes only, and is never held together with mu — holding one mutex
	// across a blocking pipe write while another goroutine needs the other to make progress is
	// what deadlocked the P52 skeleton (P54 §1.2).
	writeMu sync.Mutex

	mu         sync.Mutex
	pending    map[int]chan portResponse
	nextID     int
	subs       map[uint64]chan Event
	nextSub    uint64
	subsClosed bool

	readDone   chan struct{}
	stderrDone chan struct{}
	down       chan struct{}
	downOnce   sync.Once
	stopping   chan struct{}
	stopOnce   sync.Once

	// stream.go's bulk-data plumbing.
	dataOut     chan []byte
	queuedBytes atomic.Int64
	sinkMu      sync.Mutex
	sink        Sink
	sinkGen     uint64
}

// Start spawns nodeBin running script, with execArgv-equivalent flags (e.g.
// --max-old-space-size=<engineMemoryCapMb>) passed as extra Node arguments before the script
// path, matching today's advanced.engineMemoryCapMb behaviour (P51 §3.6).
func Start(nodeBin, script string, nodeArgs ...string) (*Host, error) {
	args := append(append([]string{}, nodeArgs...), script)
	cmd := exec.Command(nodeBin, args...)
	cmd.Env = scrubbedEnv()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("enginehost: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("enginehost: stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("enginehost: stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("enginehost: start %s: %w", nodeBin, err)
	}

	h := &Host{
		cmd:        cmd,
		stdin:      stdin,
		pending:    make(map[int]chan portResponse),
		subs:       make(map[uint64]chan Event),
		readDone:   make(chan struct{}),
		stderrDone: make(chan struct{}),
		down:       make(chan struct{}),
		stopping:   make(chan struct{}),
		dataOut:    make(chan []byte, dataQueueFrames),
	}
	go h.readLoop(stdout)
	go h.pumpStderr(stderr)
	go h.waitAndFail()
	go h.streamWriter()
	return h, nil
}

// scrubbedEnv drops NODE_OPTIONS and NODE_REPL_EXTERNAL_MODULE from the inherited environment.
// P52 §10.2: "the one part of the fuses' protection that genuinely ports, and it is not optional."
func scrubbedEnv() []string {
	inherited := os.Environ()
	out := make([]string, 0, len(inherited))
	for _, kv := range inherited {
		if strings.HasPrefix(kv, "NODE_OPTIONS=") || strings.HasPrefix(kv, "NODE_REPL_EXTERNAL_MODULE=") {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// readLoop is the transport's single reader: it owns stdout for the process lifetime, so
// cmd.Wait() (in waitAndFail) must not run until this returns (os/exec's own StdoutPipe
// requirement — P54 §1.2's second defect).
func (h *Host) readLoop(stdout io.ReadCloser) {
	defer close(h.readDone)
	r := bufio.NewReaderSize(stdout, 64<<10)
	for {
		tag, body, err := readFrame(r)
		if err != nil {
			if err == errFrameTooLarge {
				slog.Error("enginehost: frame length exceeds the protocol limit; killing engine", "scope", "engine-host")
				h.kill()
			}
			return
		}
		switch tag {
		case frameTagControl:
			h.handleControlFrame(body)
		case frameTagData:
			h.enqueueData(body)
		default:
			slog.Warn("enginehost: dropping frame with unknown channel tag", "scope", "engine-host", "tag", tag)
		}
	}
}

func (h *Host) handleControlFrame(body []byte) {
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return
	}
	switch probe.Kind {
	case "res":
		var resp portResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			return
		}
		h.mu.Lock()
		if ch, ok := h.pending[resp.ID]; ok {
			ch <- resp
			delete(h.pending, resp.ID)
		}
		h.mu.Unlock()
	case "evt":
		var evt portEvent
		if err := json.Unmarshal(body, &evt); err != nil {
			return
		}
		h.publish(Event{Topic: evt.Topic, Payload: evt.Payload})
	}
}

// pumpStderr logs the engine's stderr line-wise under scope "engine", via slog.Default() — the
// same late-bound seam P53's repos use, so installing a file handler later (internal/logging,
// P55) changes nothing here (P54 §1.6). Logged at info, not error: under stdio, stderr carries
// every ordinary console.log too, and the real failure signal is the exit code (below), not the
// text (P54 §2 D8).
func (h *Host) pumpStderr(stderr io.ReadCloser) {
	defer close(h.stderrDone)
	sc := bufio.NewScanner(stderr)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		slog.Info(line, "scope", "engine")
	}
}

// waitAndFail mirrors today's E_ENGINE_DOWN policy (no auto-respawn, P1 §13.2 unchanged): on
// child exit, every pending call fails, engine:down is published to every subscriber (as each
// one's last event, per P55's oplog reconciliation ordering need), and the down channel closes.
func (h *Host) waitAndFail() {
	<-h.readDone
	<-h.stderrDone
	err := h.cmd.Wait()
	if err != nil {
		slog.Warn("enginehost: engine process exited", "scope", "engine-host", "err", err)
	} else {
		slog.Warn("enginehost: engine process exited", "scope", "engine-host")
	}

	h.mu.Lock()
	for id, ch := range h.pending {
		ch <- portResponse{Kind: "res", ID: id, OK: false, Error: &portError{
			Code: "E_ENGINE_DOWN", Message: "engine process exited",
		}}
		delete(h.pending, id)
	}
	h.mu.Unlock()

	h.publish(Event{Topic: EventEngineDown})

	h.mu.Lock()
	h.subsClosed = true
	for id, ch := range h.subs {
		close(ch)
		delete(h.subs, id)
	}
	h.mu.Unlock()

	h.downOnce.Do(func() { close(h.down) })
	close(h.dataOut)
}

// kill is an immediate, unwaited SIGKILL used only from readLoop on a protocol error — calling
// the public Stop() there would deadlock on Down(), which cannot close until readLoop returns.
func (h *Host) kill() {
	if h.cmd.Process != nil {
		_ = h.cmd.Process.Kill()
	}
}

func (h *Host) writeRawFrame(tag byte, body []byte) error {
	frame := encodeFrame(tag, body)
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	_, err := h.stdin.Write(frame)
	return err
}

func (h *Host) writeFrame(tag byte, v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return h.writeRawFrame(tag, body)
}

// Call sends one control-channel request with DefaultTimeout.
func (h *Host) Call(op string, payload any) (json.RawMessage, error) {
	return h.CallTimeout(op, payload, DefaultTimeout)
}

// CallTimeout sends one control-channel request and blocks for its matching response, timeout,
// or engine exit — exactly as engine-host.ts's Call does over process.parentPort today. Errors
// are always *ipcerr.Error (P52 §5.3's retirement of the "[CODE] message" folding).
func (h *Host) CallTimeout(op string, payload any, timeout time.Duration) (json.RawMessage, error) {
	if !h.Alive() {
		return nil, ipcerr.EngineDown()
	}

	h.mu.Lock()
	h.nextID++
	id := h.nextID
	ch := make(chan portResponse, 1)
	h.pending[id] = ch
	h.mu.Unlock()

	if err := h.writeFrame(frameTagControl, portRequest{Kind: "req", ID: id, Op: op, Payload: payload}); err != nil {
		h.mu.Lock()
		delete(h.pending, id)
		h.mu.Unlock()
		return nil, ipcerr.EngineDown()
	}

	select {
	case resp := <-ch:
		if !resp.OK {
			code, message := "E_QUERY", ""
			if resp.Error != nil {
				message = resp.Error.Message
				if resp.Error.Code != "" {
					code = resp.Error.Code
				}
			}
			return nil, ipcerr.New(code, message)
		}
		return resp.Payload, nil
	case <-time.After(timeout):
		h.mu.Lock()
		delete(h.pending, id)
		h.mu.Unlock()
		return nil, ipcerr.New("E_TIMEOUT", fmt.Sprintf("engine call %q timed out", op))
	}
}

// publish delivers evt to every current subscriber. A stalled subscriber's full buffer is
// skipped with a warning rather than blocking the read loop.
func (h *Host) publish(evt Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subsClosed {
		return
	}
	for id, ch := range h.subs {
		select {
		case ch <- evt:
		default:
			slog.Warn("enginehost: dropping event for a stalled subscriber", "scope", "engine-host", "topic", evt.Topic, "subscriber", id)
		}
	}
}

// Subscribe returns this subscriber's own channel of every event enginehost publishes, and an
// unsubscribe func. Each subscriber gets every event — P55's connections.markAllErrored and
// oplog's reconciliation, and P56's bridge/events.go, each need their own independent feed, not
// one shared channel (P54 §1.2's Events() defect). Subscribing after the engine has already
// exited returns an already-closed channel.
func (h *Host) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 32)
	h.mu.Lock()
	if h.subsClosed {
		h.mu.Unlock()
		close(ch)
		return ch, func() {}
	}
	id := h.nextSub
	h.nextSub++
	h.subs[id] = ch
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		if c, ok := h.subs[id]; ok {
			delete(h.subs, id)
			close(c)
		}
		h.mu.Unlock()
	}
	return ch, unsubscribe
}

// Down closes once the child has exited — the same "no auto-respawn" moment that fails every
// pending call with E_ENGINE_DOWN and publishes EventEngineDown.
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

// Stop terminates the engine child: closes stdin (the shutdown signal src/engine/stdio-main.ts
// listens for), sends SIGTERM (matching engine-host.ts's child.kill()), waits up to 2s for a
// clean exit, then SIGKILLs. Idempotent.
func (h *Host) Stop() {
	h.stopOnce.Do(func() {
		close(h.stopping)
		_ = h.stdin.Close()
		if h.cmd.Process != nil {
			_ = h.cmd.Process.Signal(syscall.SIGTERM)
		}
		select {
		case <-h.down:
		case <-time.After(2 * time.Second):
			h.kill()
		}
	})
}
