package stt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory/workerproc"
)

// State is the client's coarse availability.
type State string

const (
	StateOff          State = "off" // this binary has no speech engine
	StateNotInstalled State = "notInstalled"
	StateUnavailable  State = "unavailable"
	StateReady        State = "ready"
)

// Status is State plus a human-readable cause for StateUnavailable.
type Status struct {
	State   State
	Message string
}

const (
	helloTimeout   = 30 * time.Second
	finalTimeout   = 30 * time.Second
	failureBackoff = 60 * time.Second
	// maxPendingFrames is 30 s of audio at 100 ms a frame, queued while the worker loads.
	maxPendingFrames = 300
)

// DefaultIdleTimeout is how long an unused worker keeps its model in memory.
const DefaultIdleTimeout = 5 * time.Minute

var (
	// ErrBusy means another dictation session is running.
	ErrBusy = errors.New("stt: another dictation is running")
	// ErrNotInstalled means the speech model is not on disk.
	ErrNotInstalled = errors.New("stt: speech model is not installed")
	// ErrClosed is returned after Close.
	ErrClosed = errors.New("stt: client closed")
)

// ClientOptions configures NewClient. Zero values pick the production defaults.
type ClientOptions struct {
	Spec Spec
	Home string
	// Command builds the worker process for modelDir; nil runs this executable as `memory-stt`.
	Command     func(modelDir string) *exec.Cmd
	IdleTimeout time.Duration
	// OnState runs after every change of Status, outside the client's locks.
	OnState func()
}

// Client runs dictation sessions in a lazily spawned worker process, so the model's memory returns
// to the OS when the worker exits after IdleTimeout, and a native crash cannot take the host down.
type Client struct {
	opts ClientOptions
	dir  string

	mu       sync.Mutex
	w        *worker
	cur      *Session
	lastErr  error
	failedAt time.Time
	closed   bool
	idle     *time.Timer
	nextSID  int
	notified Status
}

func NewClient(o ClientOptions) *Client {
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = DefaultIdleTimeout
	}
	if o.Command == nil {
		o.Command = defaultCommand
	}
	c := &Client{opts: o, dir: ModelDir(o.Home, o.Spec)}
	c.notified = c.Status()
	return c
}

func defaultCommand(modelDir string) *exec.Cmd {
	exe, err := os.Executable()
	if err != nil {
		return exec.Command("kira-space-missing-executable")
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exec.Command(exe, "memory-stt", "--model-dir", modelDir)
}

func (c *Client) Spec() Spec { return c.opts.Spec }

// Dir is the directory the model installs into.
func (c *Client) Dir() string { return c.dir }

// Status reports availability without spawning anything.
func (c *Client) Status() Status {
	if !Built {
		return Status{State: StateOff}
	}
	if !Installed(c.dir, c.opts.Spec) {
		return Status{State: StateNotInstalled}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.lastErr != nil {
		return Status{State: StateUnavailable, Message: c.lastErr.Error()}
	}
	return Status{State: StateReady}
}

func (c *Client) notify() {
	st := c.Status()
	c.mu.Lock()
	changed := st != c.notified
	c.notified = st
	c.mu.Unlock()
	if changed && c.opts.OnState != nil {
		c.opts.OnState()
	}
}

// Reset clears a recorded failure and its spawn backoff, e.g. after an install or a retry.
func (c *Client) Reset() {
	c.mu.Lock()
	c.lastErr, c.failedAt = nil, time.Time{}
	c.mu.Unlock()
	c.notify()
}

// Handler receives live session text. stable is the UTF-16 length of the text that will not change.
type Handler func(text string, stable int)

// Session is one dictation: audio in, live text out, a final text at Stop.
type Session struct {
	c       *Client
	sid     int
	handler Handler

	mu      sync.Mutex
	w       *worker
	pending []string // audio frames queued before the worker is ready
	ready   bool
	text    string
	ended   bool
	cancel  context.CancelFunc

	readyCh chan struct{} // closed when the worker accepted the session or failed to start
	readyEr error
	result  chan result // buffered: the first final or error
}

type result struct {
	text string
	err  error
}

// Begin reserves the process-wide session slot and starts the worker in the background. Audio
// passed to Audio before the worker is ready is queued. It returns ErrBusy when a session runs.
func (c *Client) Begin(ctx context.Context, glossary []string, h Handler) (*Session, error) {
	c.mu.Lock()
	switch {
	case c.closed:
		c.mu.Unlock()
		return nil, ErrClosed
	case c.cur != nil:
		c.mu.Unlock()
		return nil, ErrBusy
	}
	c.nextSID++
	sctx, cancel := context.WithCancel(ctx)
	s := &Session{c: c, sid: c.nextSID, handler: h, cancel: cancel, readyCh: make(chan struct{}), result: make(chan result, 1)}
	c.cur = s
	if c.idle != nil {
		c.idle.Stop()
	}
	c.mu.Unlock()
	go s.start(sctx, glossary)
	return s, nil
}

func (s *Session) start(ctx context.Context, glossary []string) {
	w, err := s.c.ensureWorker(ctx)
	if err == nil && s.isEnded() {
		err = context.Canceled
	}
	if err == nil {
		err = s.c.send(w, request{Type: msgStart, SID: s.sid, Glossary: glossary})
		if err != nil {
			err = s.c.workerFailed(w, err)
		}
	}
	s.mu.Lock()
	s.readyEr = err
	if err == nil {
		s.w, s.ready = w, true
		for _, p := range s.pending {
			if e := s.c.send(w, request{Type: msgAudio, SID: s.sid, PCM: p}); e != nil {
				break
			}
		}
		s.pending = nil
	}
	s.mu.Unlock()
	close(s.readyCh)
	if err != nil {
		s.finish(result{err: err})
	}
}

func (s *Session) isEnded() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ended
}

// Ready is closed once the worker accepted the session or failed; Err then says which.
func (s *Session) Ready() <-chan struct{} { return s.readyCh }

// Err is the start failure, valid after Ready is closed.
func (s *Session) Err() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readyEr
}

// Audio sends one 16 kHz mono chunk.
func (s *Session) Audio(pcm []int16) {
	frame := encodePCM(pcm)
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.ended:
	case !s.ready:
		if len(s.pending) >= maxPendingFrames {
			s.pending = s.pending[1:]
		}
		s.pending = append(s.pending, frame)
	default:
		_ = s.c.send(s.w, request{Type: msgAudio, SID: s.sid, PCM: frame})
	}
}

// Stop finishes the session and returns the final text. A worker that does not answer in time is
// killed; the text so far comes back with the error.
func (s *Session) Stop() (string, error) {
	<-s.readyCh
	s.mu.Lock()
	w := s.w
	s.mu.Unlock()
	if w != nil {
		_ = s.c.send(w, request{Type: msgStop, SID: s.sid})
	}
	select {
	case r := <-s.result:
		return s.orText(r)
	case <-time.After(finalTimeout):
		if w != nil {
			w.Kill()
		}
		s.finish(result{err: errors.New("speech worker did not finish in time")})
		return s.orText(<-s.result)
	}
}

func (s *Session) orText(r result) (string, error) {
	if r.err != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.text, r.err
	}
	return r.text, nil
}

// Cancel abandons the session; the worker stays up for reuse.
func (s *Session) Cancel() {
	s.cancel()
	s.mu.Lock()
	w, ready := s.w, s.ready
	s.mu.Unlock()
	if ready && w != nil {
		_ = s.c.send(w, request{Type: msgCancel, SID: s.sid})
	}
	s.finish(result{text: ""})
}

// finish ends the session once and frees the client's slot.
func (s *Session) finish(r result) {
	s.mu.Lock()
	if s.ended {
		s.mu.Unlock()
		return
	}
	s.ended = true
	s.mu.Unlock()
	s.result <- r
	s.cancel()
	c := s.c
	c.mu.Lock()
	if c.cur == s {
		c.cur = nil
	}
	c.mu.Unlock()
	c.armIdle()
	c.notify()
}

func (c *Client) setErr(err error) {
	c.mu.Lock()
	c.lastErr = err
	c.mu.Unlock()
}

// worker is a running process plus its dedicated reader goroutine.
type worker struct {
	*workerproc.Proc
	wmu sync.Mutex // serialises stdin writes
}

func (c *Client) send(w *worker, r request) error {
	w.wmu.Lock()
	defer w.wmu.Unlock()
	return json.NewEncoder(w.Stdin).Encode(r)
}

// workerFailed drops a worker whose pipe broke and returns the error to surface.
func (c *Client) workerFailed(w *worker, cause error) error {
	w.Kill()
	c.dropWorker(w)
	err := fmt.Errorf("speech worker failed: %w%s", cause, w.Diagnostics())
	c.setErr(err)
	return err
}

func (c *Client) dropWorker(w *worker) {
	c.mu.Lock()
	if c.w == w {
		c.w = nil
	}
	c.mu.Unlock()
}

// ensureWorker returns the running worker, spawning one when needed. A failed spawn is refused
// again for failureBackoff so repeated clicks cannot spawn-storm.
func (c *Client) ensureWorker(ctx context.Context) (*worker, error) {
	c.mu.Lock()
	switch {
	case c.closed:
		c.mu.Unlock()
		return nil, ErrClosed
	case c.w != nil:
		w := c.w
		c.mu.Unlock()
		return w, nil
	case c.lastErr != nil && !c.failedAt.IsZero() && time.Since(c.failedAt) < failureBackoff:
		err := c.lastErr
		c.mu.Unlock()
		return nil, err
	}
	c.mu.Unlock()

	if !Installed(c.dir, c.opts.Spec) {
		return nil, ErrNotInstalled
	}
	w, err := c.spawn(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		c.lastErr, c.failedAt = err, time.Now()
		return nil, err
	}
	c.lastErr, c.failedAt = nil, time.Time{}
	c.w = w
	go c.readLoop(w)
	return w, nil
}

func (c *Client) spawn(ctx context.Context) (*worker, error) {
	proc, err := workerproc.Start(c.opts.Command(c.dir))
	if err != nil {
		return nil, fmt.Errorf("start speech worker: %w", err)
	}
	w := &worker{Proc: proc}
	var h hello
	if err := w.Hello(ctx, helloTimeout, &h); err != nil {
		if errors.Is(err, workerproc.ErrHelloTimeout) {
			return nil, fmt.Errorf("speech worker did not start in time%s", w.Diagnostics())
		}
		return nil, fmt.Errorf("speech worker exited before ready: %w%s", err, w.Diagnostics())
	}
	if h.Error != "" || !h.Ready {
		w.Kill()
		msg := h.Error
		if msg == "" {
			msg = "unexpected hello"
		}
		return nil, errors.New(msg)
	}
	return w, nil
}

// readLoop routes one worker's replies to the current session until the worker exits.
func (c *Client) readLoop(w *worker) {
	for {
		var r reply
		if err := w.Dec.Decode(&r); err != nil {
			c.mu.Lock()
			current := c.w == w
			s := c.cur
			c.mu.Unlock()
			if !current {
				return // stopped on purpose
			}
			err = c.workerFailed(w, err)
			if s != nil {
				s.finish(result{err: err})
			}
			return
		}
		c.mu.Lock()
		s := c.cur
		c.mu.Unlock()
		if s == nil || r.SID != s.sid {
			continue
		}
		switch r.Type {
		case replyText:
			s.mu.Lock()
			s.text = r.Text
			ended := s.ended
			s.mu.Unlock()
			if !ended && s.handler != nil {
				s.handler(r.Text, r.Stable)
			}
		case replyFinal:
			s.finish(result{text: r.Text})
		case replyError:
			s.finish(result{err: fmt.Errorf("speech worker: %s", r.Error)})
		}
	}
}

func (c *Client) armIdle() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.w == nil || c.cur != nil {
		return
	}
	if c.idle != nil {
		c.idle.Stop()
	}
	c.idle = time.AfterFunc(c.opts.IdleTimeout, c.onIdle)
}

func (c *Client) onIdle() {
	c.mu.Lock()
	if c.cur != nil {
		c.mu.Unlock()
		return // a session is running; its end re-arms the timer
	}
	w := c.w
	c.w = nil
	c.mu.Unlock()
	if w != nil {
		w.Stop()
	}
}

// Close cancels any session, stops the worker and refuses further sessions.
func (c *Client) Close() error {
	c.mu.Lock()
	c.closed = true
	if c.idle != nil {
		c.idle.Stop()
	}
	s := c.cur
	w := c.w
	c.w = nil
	c.mu.Unlock()
	if s != nil {
		s.Cancel()
	}
	if w != nil {
		w.Stop()
	}
	return nil
}
