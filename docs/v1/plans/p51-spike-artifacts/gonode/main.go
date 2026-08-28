// Prototype for P51 §3.3 — the Go side of the Go<->Node engine transport:
// spawner, length-prefixed framer, pending-call map, event fan-out.
// Standalone spike code, not wired into the real app tree.
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"
)

type portRequest struct {
	Kind    string `json:"kind"`
	ID      int    `json:"id"`
	Op      string `json:"op"`
	Payload any    `json:"payload,omitempty"`
}

type portResponse struct {
	Kind    string          `json:"kind"`
	ID      int             `json:"id"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

type portEvent struct {
	Kind    string          `json:"kind"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

// EngineHost is the Go analogue of src/main/engine-host.ts.
type EngineHost struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	mu      sync.Mutex
	pending map[int]chan portResponse
	nextID  int
	events  chan portEvent
}

func StartEngine(nodeBin, script string) (*EngineHost, error) {
	cmd := exec.Command(nodeBin, script)
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	h := &EngineHost{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		pending: make(map[int]chan portResponse),
		events:  make(chan portEvent, 16),
	}
	go h.readLoop()
	go func() {
		// Mirrors today's E_ENGINE_DOWN policy (§3.6): on exit, fail every
		// pending call rather than auto-respawn.
		_ = cmd.Wait()
		h.mu.Lock()
		defer h.mu.Unlock()
		for id, ch := range h.pending {
			ch <- portResponse{Kind: "res", ID: id, OK: false, Error: &struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			}{Message: "engine exited", Code: "E_ENGINE_DOWN"}}
			delete(h.pending, id)
		}
		close(h.events)
	}()
	return h, nil
}

func (h *EngineHost) readLoop() {
	r := bufio.NewReader(h.stdout)
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
			default:
			}
		}
	}
}

func (h *EngineHost) writeFrame(v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(body)))
	if _, err := h.stdin.Write(lenBuf[:]); err != nil {
		return err
	}
	_, err = h.stdin.Write(body)
	return err
}

func (h *EngineHost) Call(op string, payload any, timeout time.Duration) (json.RawMessage, error) {
	h.mu.Lock()
	h.nextID++
	id := h.nextID
	ch := make(chan portResponse, 1)
	h.pending[id] = ch
	h.mu.Unlock()

	if err := h.writeFrame(portRequest{Kind: "req", ID: id, Op: op, Payload: payload}); err != nil {
		return nil, err
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
		return nil, fmt.Errorf("call %q timed out after %s", op, timeout)
	}
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: gonode <path-to-engine_stub.mjs>")
	}
	host, err := StartEngine("node", os.Args[1])
	if err != nil {
		log.Fatalf("spawn failed: %v", err)
	}

	go func() {
		for evt := range host.events {
			fmt.Printf("[event] topic=%s payload=%s\n", evt.Topic, evt.Payload)
		}
	}()

	if payload, err := host.Call("ping", nil, 2*time.Second); err != nil {
		log.Fatalf("ping failed: %v", err)
	} else {
		fmt.Printf("[ping] %s\n", payload)
	}

	if payload, err := host.Call("echo", map[string]string{"hello": "world"}, 2*time.Second); err != nil {
		log.Fatalf("echo failed: %v", err)
	} else {
		fmt.Printf("[echo] %s\n", payload)
	}

	start := time.Now()
	payload, err := host.Call("bulk", map[string]int{"rows": 50000}, 5*time.Second)
	elapsed := time.Since(start)
	if err != nil {
		log.Fatalf("bulk failed: %v", err)
	}
	fmt.Printf("[bulk] %d bytes in %s\n", len(payload), elapsed)

	if _, err := host.Call("boom", nil, 2*time.Second); err != nil {
		fmt.Printf("[boom] got expected error: %v\n", err)
	}

	time.Sleep(200 * time.Millisecond) // let the event drain
	_ = host.cmd.Process.Kill()
}
