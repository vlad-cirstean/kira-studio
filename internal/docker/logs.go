package docker

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
)

const (
	maxLogLine       = 64 * 1024
	truncationMarker = "…"
	logsCoalesce     = 16 * time.Millisecond
	logsCoalesceMax  = 500
)

// LogLine is one framed log line.
type LogLine struct {
	Stream string `json:"stream"` // "stdout" | "stderr"
	TS     string `json:"ts,omitempty"`
	Text   string `json:"text"`
}

// LogsEvent is ChannelLogs' payload: a batch of lines for one stream, or its end.
type LogsEvent struct {
	StreamID string    `json:"streamId"`
	Lines    []LogLine `json:"lines"`
	Ended    bool      `json:"ended"`
	Error    string    `json:"error,omitempty"`
}

type framerStream struct {
	buf      []byte
	skipping bool // dropping the rest of an over-long line
}

// lineFramer turns raw chunks of each stream into lines: it keeps partial lines per stream, strips
// one trailing CR, truncates a line at maxLogLine and splits the RFC3339Nano timestamp prefix.
type lineFramer struct {
	timestamps bool
	streams    map[string]*framerStream
}

func newLineFramer(timestamps bool) *lineFramer {
	return &lineFramer{timestamps: timestamps, streams: map[string]*framerStream{}}
}

func (f *lineFramer) state(stream string) *framerStream {
	s := f.streams[stream]
	if s == nil {
		s = &framerStream{}
		f.streams[stream] = s
	}
	return s
}

func (f *lineFramer) write(stream string, p []byte) []LogLine {
	s := f.state(stream)
	var out []LogLine
	for len(p) > 0 {
		nl := bytes.IndexByte(p, '\n')
		chunk := p
		if nl >= 0 {
			chunk = p[:nl]
		}
		if !s.skipping {
			s.buf = append(s.buf, chunk...)
			if len(s.buf) > maxLogLine {
				out = append(out, f.line(stream, s.buf[:maxLogLine], true))
				s.buf, s.skipping = nil, true
			}
		}
		if nl < 0 {
			break
		}
		if s.skipping {
			s.skipping = false
		} else {
			out = append(out, f.line(stream, s.buf, false))
			s.buf = nil
		}
		p = p[nl+1:]
	}
	return out
}

// flush emits each stream's trailing partial line at EOF.
func (f *lineFramer) flush() []LogLine {
	var out []LogLine
	for _, stream := range []string{"stdout", "stderr"} {
		if s := f.streams[stream]; s != nil && len(s.buf) > 0 {
			out = append(out, f.line(stream, s.buf, false))
			s.buf = nil
		}
	}
	return out
}

func (f *lineFramer) line(stream string, raw []byte, truncated bool) LogLine {
	raw = bytes.TrimSuffix(raw, []byte("\r"))
	var ts string
	if f.timestamps {
		if sp := bytes.IndexByte(raw, ' '); sp > 0 {
			if _, err := time.Parse(time.RFC3339Nano, string(raw[:sp])); err == nil {
				ts, raw = string(raw[:sp]), raw[sp+1:]
			}
		}
	}
	text := strings.ToValidUTF8(string(raw), "�")
	if truncated {
		text += truncationMarker
	}
	return LogLine{Stream: stream, TS: ts, Text: text}
}

type logStream struct {
	windowKey string
	cancel    context.CancelFunc
}

type logRegistry struct {
	mu      sync.Mutex
	streams map[string]*logStream
}

func newLogRegistry() *logRegistry { return &logRegistry{streams: map[string]*logStream{}} }

func (r *logRegistry) add(id string, s *logStream) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.streams[id]; dup {
		return false
	}
	r.streams[id] = s
	return true
}

func (r *logRegistry) remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.streams, id)
}

func (r *logRegistry) close(id string) {
	r.mu.Lock()
	s := r.streams[id]
	delete(r.streams, id)
	r.mu.Unlock()
	if s != nil {
		s.cancel()
	}
}

func (r *logRegistry) closeWindow(windowKey string) {
	r.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(r.streams))
	for id, s := range r.streams {
		if s.windowKey == windowKey {
			cancels = append(cancels, s.cancel)
			delete(r.streams, id)
		}
	}
	r.mu.Unlock()
	for _, c := range cancels {
		c()
	}
}

func (r *logRegistry) closeAll() {
	r.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(r.streams))
	for id, s := range r.streams {
		cancels = append(cancels, s.cancel)
		delete(r.streams, id)
	}
	r.mu.Unlock()
	for _, c := range cancels {
		c()
	}
}

type logsFinal struct{ err string }

// LogsOpenArgs is LogsOpen's wire shape.
type LogsOpenArgs struct {
	WindowKey   string `json:"windowKey"`
	StreamID    string `json:"streamId"`
	ContainerID string `json:"containerId"`
	Tail        int    `json:"tail"` // -1 = all
	Timestamps  bool   `json:"timestamps"`
	Follow      bool   `json:"follow"`
}

// logsOpen starts streaming a container's logs to windowKey over ChannelLogs. Engine errors
// (unknown container, daemon down) return here; later failures arrive as the stream's final event.
func (m *Manager) logsOpen(args LogsOpenArgs) error {
	if args.WindowKey == "" || args.StreamID == "" || args.ContainerID == "" {
		return ipcerr.New("E_INVALID", "windowKey, streamId and containerId are required")
	}
	if args.Tail < -1 {
		return ipcerr.New("E_INVALID", "tail must be -1 (all) or a line count")
	}
	ctx, cancel := context.WithCancel(context.Background())
	if !m.logs.add(args.StreamID, &logStream{windowKey: args.WindowKey, cancel: cancel}) {
		cancel()
		return ipcerr.New("E_INVALID", "streamId is already open")
	}
	body, tty, err := m.openLogs(ctx, args)
	if err != nil {
		m.logs.remove(args.StreamID)
		cancel()
		return err
	}
	go m.pumpLogs(ctx, cancel, args, body, tty)
	return nil
}

func (m *Manager) openLogs(ctx context.Context, args LogsOpenArgs) (io.ReadCloser, bool, error) {
	cli, ep, err := m.client()
	if err != nil {
		return nil, false, m.mapErr(ep, err)
	}
	ictx, icancel := context.WithTimeout(ctx, callTimeout)
	defer icancel()
	info, err := cli.ContainerInspect(ictx, args.ContainerID, client.ContainerInspectOptions{})
	if err != nil {
		return nil, false, m.mapErr(ep, err)
	}
	tail := "all"
	if args.Tail >= 0 {
		tail = strconv.Itoa(args.Tail)
	}
	body, err := cli.ContainerLogs(ctx, args.ContainerID, client.ContainerLogsOptions{
		ShowStdout: true, ShowStderr: true, Follow: args.Follow, Tail: tail, Timestamps: args.Timestamps,
	})
	if err != nil {
		return nil, false, m.mapErr(ep, err)
	}
	return body, info.Container.Config != nil && info.Container.Config.Tty, nil
}

type lineWriter struct {
	stream string
	framer *lineFramer
	push   func(LogLine)
}

func (w lineWriter) Write(p []byte) (int, error) {
	for _, l := range w.framer.write(w.stream, p) {
		w.push(l)
	}
	return len(p), nil
}

func (m *Manager) pumpLogs(ctx context.Context, cancel context.CancelFunc, args LogsOpenArgs, body io.ReadCloser, tty bool) {
	defer cancel()
	defer m.logs.remove(args.StreamID)
	defer body.Close()

	co := appevent.NewCoalescer(logsCoalesce, logsCoalesceMax, func(LogLine) int { return 1 },
		func(batch []LogLine, done bool, final logsFinal) {
			m.Emit.EmitTo(args.WindowKey, ChannelLogs, LogsEvent{StreamID: args.StreamID, Lines: batch, Ended: done, Error: final.err})
		})
	framer := newLineFramer(args.Timestamps)
	var err error
	if tty {
		_, err = io.Copy(lineWriter{"stdout", framer, co.Push}, body)
	} else {
		_, err = stdcopy.StdCopy(lineWriter{"stdout", framer, co.Push}, lineWriter{"stderr", framer, co.Push}, body)
	}
	for _, l := range framer.flush() {
		co.Push(l)
	}
	final := logsFinal{}
	if err != nil && ctx.Err() == nil && !errors.Is(err, io.EOF) {
		final.err = err.Error()
	}
	co.Finish(final)
}

func (m *Manager) logsClose(streamID string) { m.logs.close(streamID) }
