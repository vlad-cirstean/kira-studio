package stt

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Frame is one message of the dictation stream to the UI.
type Frame struct {
	Type      string   `json:"type"` // state | text | final | error
	State     string   `json:"state,omitempty"`
	Level     *float64 `json:"level,omitempty"`
	Text      string   `json:"text,omitempty"`
	Committed int      `json:"committed,omitempty"`
	Code      string   `json:"code,omitempty"` // busy | notInstalled | mic | worker
	Message   string   `json:"message,omitempty"`
}

// Dictation limits.
const (
	MaxDuration     = 10 * time.Minute
	SilenceAutoStop = 30 * time.Second
	zeroAudioLimit  = time.Second
	silenceLevel    = 0.003
	// MicDeniedMessage is shown when the OS hands back all-zero audio, which is how macOS reports
	// a refused microphone permission.
	MicDeniedMessage = "No audio from the microphone. Allow Kira Space in System Settings > Privacy & Security > Microphone."
)

// DictateOptions configures Client.Dictate.
type DictateOptions struct {
	Mic      MicOpener // nil uses OpenMic
	Glossary []string
	Emit     func(Frame)
}

// Dictation is one running mic session: capture -> worker -> live frames.
type Dictation struct {
	c    *Client
	sess *Session
	emit func(Frame)

	mu       sync.Mutex
	stopMic  func()
	chunks   chan []int16
	rest     []int16
	ending   bool
	ended    chan struct{} // closed when capture stops
	pumpDone chan struct{}
	done     chan struct{}
	started  time.Time

	// pump-goroutine state
	heard    bool
	zeroRun  int
	quietRun int
}

// Dictate reserves the session slot, starts the worker and the microphone, and streams frames to
// o.Emit until the session ends. It returns ErrBusy when another session runs. Stop finishes
// with a final frame; Cancel and ctx cancellation discard the session.
func (c *Client) Dictate(ctx context.Context, o DictateOptions) (*Dictation, error) {
	if o.Mic == nil {
		o.Mic = OpenMic
	}
	d := &Dictation{c: c, emit: o.Emit, chunks: make(chan []int16, 600), ended: make(chan struct{}), pumpDone: make(chan struct{}), done: make(chan struct{}), started: time.Now()}
	sess, err := c.Begin(ctx, o.Glossary, func(text string, stable int) {
		d.send(Frame{Type: "text", Text: text, Committed: stable})
	})
	if err != nil {
		return nil, err
	}
	d.sess = sess
	d.send(Frame{Type: "state", State: "starting", Level: ptr(0)})
	stop, err := o.Mic(d.onPCM)
	if err != nil {
		d.fail("mic", err.Error())
		return d, nil
	}
	d.mu.Lock()
	d.stopMic = stop
	d.mu.Unlock()
	go d.pump()
	go func() {
		select {
		case <-sess.Ready():
			if err := sess.Err(); err != nil {
				d.fail(startErrCode(err), err.Error())
				return
			}
			d.send(Frame{Type: "state", State: "listening", Level: ptr(0)})
		case <-d.done:
		}
	}()
	go func() {
		select {
		case <-ctx.Done():
			d.Cancel()
		case <-d.done:
		}
	}()
	return d, nil
}

func startErrCode(err error) string {
	if errors.Is(err, ErrNotInstalled) {
		return "notInstalled"
	}
	return "worker"
}

func ptr(f float64) *float64 { return &f }

// Done is closed when the session has ended and its last frame was sent.
func (d *Dictation) Done() <-chan struct{} { return d.done }

func (d *Dictation) send(f Frame) {
	d.mu.Lock()
	closed := false
	select {
	case <-d.done:
		closed = true
	default:
	}
	d.mu.Unlock()
	if !closed && d.emit != nil {
		d.emit(f)
	}
}

// onPCM runs on the audio thread: it only regroups samples into 100 ms chunks.
func (d *Dictation) onPCM(pcm []int16) {
	d.mu.Lock()
	if d.ending {
		d.mu.Unlock()
		return
	}
	d.rest = append(d.rest, pcm...)
	var out [][]int16
	for len(d.rest) >= chunkFrames {
		out = append(out, append([]int16(nil), d.rest[:chunkFrames]...))
		d.rest = d.rest[chunkFrames:]
	}
	d.mu.Unlock()
	for _, c := range out {
		select {
		case d.chunks <- c:
		default: // the pump is far behind; drop rather than stall the audio thread
		}
	}
}

// pump forwards chunks to the worker, reports levels and enforces the limits.
func (d *Dictation) pump() {
	defer close(d.pumpDone)
	for {
		select {
		case c := <-d.chunks:
			d.handleChunk(c)
		case <-d.ended:
			return
		}
	}
}

func (d *Dictation) handleChunk(c []int16) {
	d.sess.Audio(c)
	lvl := rms(c)
	d.send(Frame{Type: "state", State: "listening", Level: ptr(min(1, lvl*8))})

	if allZero(c) {
		d.zeroRun += len(c)
	} else {
		d.zeroRun, d.heard = 0, true
	}
	if !d.heard && time.Duration(d.zeroRun)*time.Second/captureRate >= zeroAudioLimit {
		d.fail("mic", MicDeniedMessage)
		return
	}
	if lvl < silenceLevel {
		d.quietRun += len(c)
	} else {
		d.quietRun = 0
	}
	if time.Duration(d.quietRun)*time.Second/captureRate >= SilenceAutoStop || time.Since(d.started) >= MaxDuration {
		d.Stop()
	}
}

// Stop stops the microphone and finishes the session with a final frame. It does not block.
func (d *Dictation) Stop() {
	if !d.beginEnd() {
		return
	}
	d.send(Frame{Type: "state", State: "finishing", Level: ptr(0)})
	go func() {
		<-d.pumpDone
		d.drainRest()
		text, err := d.sess.Stop()
		if err != nil {
			d.send(Frame{Type: "error", Code: "worker", Message: err.Error(), Text: text})
		} else {
			d.send(Frame{Type: "final", Text: text})
		}
		d.close()
	}()
}

// Cancel stops the microphone and discards the session.
func (d *Dictation) Cancel() {
	if !d.beginEnd() {
		return
	}
	d.sess.Cancel()
	d.close()
}

// beginEnd stops capture once; it reports whether this call won.
func (d *Dictation) beginEnd() bool {
	d.mu.Lock()
	if d.ending {
		d.mu.Unlock()
		return false
	}
	d.ending = true
	close(d.ended)
	stop := d.stopMic
	d.stopMic = nil
	d.mu.Unlock()
	if stop != nil {
		stop()
	}
	return true
}

// drainRest forwards queued chunks and the sub-chunk tail after the microphone stopped.
func (d *Dictation) drainRest() {
	for {
		select {
		case c := <-d.chunks:
			d.sess.Audio(c)
		default:
			d.mu.Lock()
			tail := d.rest
			d.rest = nil
			d.mu.Unlock()
			if len(tail) > 0 {
				d.sess.Audio(tail)
			}
			return
		}
	}
}

// fail ends the session with an error frame.
func (d *Dictation) fail(code, msg string) {
	if d.beginEnd() {
		d.sess.Cancel()
	}
	d.send(Frame{Type: "error", Code: code, Message: msg})
	d.close()
}

func (d *Dictation) close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	select {
	case <-d.done:
	default:
		close(d.done)
	}
}
