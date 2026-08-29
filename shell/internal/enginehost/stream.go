package enginehost

import (
	"errors"
	"log/slog"
	"time"
)

// ErrStreamFull is what a Sink returns when it has no room for the frame right now and did not
// take it. enginehost retries on errors.Is(err, ErrStreamFull) and treats every other error as
// "this session is gone" (P54 §2 D9).
var ErrStreamFull = errors.New("enginehost: stream sink full")

// Sink is the whole of what enginehost needs from a renderer-facing stream session — deliberately
// one method, so this package never imports Wails (P54 §2 D14). P56 satisfies it with a small
// adapter over *application.StreamConn; Wails' own Send blocks rather than returning
// ErrStreamFull (that is TrySend), so the adapter may pass Send straight through.
type Sink interface {
	Send(frame []byte) error
}

// maxDataFrameBytes is Wails' own streamMaxFrameBytes
// (pkg/application/stream_transport.go:50, v3.0.0-beta.15). A var, not a const, so
// stream_internal_test.go can lower it.
var maxDataFrameBytes = 64 << 20

const (
	dataQueueFrames = 64
	dataQueueBytes  = 32 << 20

	sendBackoffMin = 2 * time.Millisecond
	sendBackoffMax = 50 * time.Millisecond
)

// AttachStream makes s the current sink, superseding any previous one, and returns the detach
// func. With no sink attached, data frames are consumed and dropped — the Go-side analogue of
// index.ts's "no-op when no port is attached".
func (h *Host) AttachStream(s Sink) (detach func()) {
	h.sinkMu.Lock()
	h.sinkGen++
	gen := h.sinkGen
	h.sink = s
	h.sinkMu.Unlock()

	return func() {
		h.sinkMu.Lock()
		if h.sinkGen == gen {
			h.sink = nil
		}
		h.sinkMu.Unlock()
	}
}

// currentSink returns the active sink and its generation, so a caller sleeping mid-retry can tell
// whether the sink it was talking to has since been superseded.
func (h *Host) currentSink() (Sink, uint64) {
	h.sinkMu.Lock()
	defer h.sinkMu.Unlock()
	return h.sink, h.sinkGen
}

// detachIfCurrent clears the sink only if it is still the one identified by gen — an older,
// already-superseded sink must not clobber whatever replaced it.
func (h *Host) detachIfCurrent(gen uint64) {
	h.sinkMu.Lock()
	if h.sinkGen == gen {
		h.sink = nil
	}
	h.sinkMu.Unlock()
}

// SendData writes one renderer-originated frame to the engine on the data channel. Go does not
// parse it — frame is written to the wire exactly as given, never passed through json.Marshal.
func (h *Host) SendData(frame []byte) error {
	return h.writeRawFrame(frameTagData, frame)
}

// enqueueData is called from readLoop for every tag-1 frame. Blocking on a full queue is what
// propagates OS pipe backpressure back to the engine (P52 §7.2): the read loop simply stops
// reading stdout until the writer goroutine catches up.
func (h *Host) enqueueData(body []byte) {
	for h.queuedBytes.Load() >= dataQueueBytes {
		select {
		case <-h.stopping:
			return
		case <-time.After(2 * time.Millisecond):
		}
	}
	h.queuedBytes.Add(int64(len(body)))
	select {
	case h.dataOut <- body:
	case <-h.stopping:
	}
}

// streamWriter drains the bounded queue and delivers each frame to the current sink, retrying on
// ErrStreamFull with a bounded, doubling backoff (P54 §2 D9).
func (h *Host) streamWriter() {
	for body := range h.dataOut {
		h.queuedBytes.Add(-int64(len(body)))
		h.deliver(body)
	}
}

func (h *Host) deliver(frame []byte) {
	if len(frame) > maxDataFrameBytes {
		slog.Error("enginehost: dropping oversized data frame", "scope", "engine-host",
			"bytes", len(frame), "limit", maxDataFrameBytes)
		return
	}

	delay := sendBackoffMin
	for {
		sink, gen := h.currentSink()
		if sink == nil {
			return // no sink attached: drop, matching index.ts's no-port no-op.
		}
		err := sink.Send(frame)
		if err == nil {
			return
		}
		if !errors.Is(err, ErrStreamFull) {
			h.detachIfCurrent(gen)
			slog.Warn("enginehost: detaching stream sink after a send error", "scope", "engine-host", "err", err)
			return
		}
		select {
		case <-h.stopping:
			return
		case <-time.After(delay):
		}
		if _, curGen := h.currentSink(); curGen != gen {
			return // superseded while we were waiting: this frame belongs to a dead session.
		}
		delay *= 2
		if delay > sendBackoffMax {
			delay = sendBackoffMax
		}
	}
}
