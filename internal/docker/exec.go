package docker

import (
	"context"
	"encoding/base64"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/moby/moby/client"
)

const (
	execCoalesce    = 16 * time.Millisecond
	execCoalesceMax = 16 * 1024
	execShell       = "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"
)

type execSession struct {
	windowKey string
	execID    string
	conn      client.HijackedResponse
	cancel    context.CancelFunc
}

type execRegistry struct {
	mu       sync.Mutex
	sessions map[string]*execSession
	pending  map[string]string // terminalId -> windowKey while ExecOpen is still dialling
}

func newExecRegistry() *execRegistry {
	return &execRegistry{sessions: map[string]*execSession{}, pending: map[string]string{}}
}

// reserve claims id; false when it is already live or opening.
func (r *execRegistry) reserve(id, windowKey string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.sessions[id]; ok {
		return false
	}
	if _, ok := r.pending[id]; ok {
		return false
	}
	r.pending[id] = windowKey
	return true
}

// register publishes a dialled session; false when its window closed while it was opening.
func (r *execRegistry) register(id string, s *execSession) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pending[id] != s.windowKey {
		return false
	}
	delete(r.pending, id)
	r.sessions[id] = s
	return true
}

func (r *execRegistry) release(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.pending, id)
}

func (r *execRegistry) get(id string) *execSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessions[id]
}

func (r *execRegistry) take(id string) *execSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.sessions[id]
	delete(r.sessions, id)
	return s
}

func (s *execSession) close() {
	s.cancel()
	s.conn.Close()
}

func (r *execRegistry) closeWindow(windowKey string) {
	r.mu.Lock()
	var doomed []*execSession
	for id, key := range r.pending {
		if key == windowKey {
			delete(r.pending, id)
		}
	}
	for id, s := range r.sessions {
		if s.windowKey == windowKey {
			doomed = append(doomed, s)
			delete(r.sessions, id)
		}
	}
	r.mu.Unlock()
	for _, s := range doomed {
		s.close()
	}
}

func (r *execRegistry) closeAll() {
	r.mu.Lock()
	doomed := make([]*execSession, 0, len(r.sessions))
	for id, s := range r.sessions {
		doomed = append(doomed, s)
		delete(r.sessions, id)
	}
	r.mu.Unlock()
	for _, s := range doomed {
		s.close()
	}
}

// ExecOpenArgs is ExecOpen's wire shape.
type ExecOpenArgs struct {
	WindowKey   string `json:"windowKey"`
	TerminalID  string `json:"terminalId"`
	ContainerID string `json:"containerId"`
	Cols        int    `json:"cols"`
	Rows        int    `json:"rows"`
}

// ExecOpenResult is ExecOpen's wire shape.
type ExecOpenResult struct {
	Shell string `json:"shell"`
}

type execFinal struct {
	exitCode int
	errMsg   string
}

// execOpen starts a tty shell inside a running container and streams it over ChannelExec in the
// terminal module's own event shape.
func (m *Manager) execOpen(args ExecOpenArgs) (ExecOpenResult, error) {
	if args.WindowKey == "" || args.TerminalID == "" || args.ContainerID == "" {
		return ExecOpenResult{}, ipcerr.New("E_INVALID", "windowKey, terminalId and containerId are required")
	}
	if !terminal.ValidDim(args.Cols) || !terminal.ValidDim(args.Rows) {
		return ExecOpenResult{}, ipcerr.New("E_INVALID", "cols/rows must be within [1, 1000]")
	}
	if !m.execs.reserve(args.TerminalID, args.WindowKey) {
		return ExecOpenResult{}, ipcerr.New("E_INVALID", "terminalId is already open")
	}
	defer m.execs.release(args.TerminalID)

	cli, ep, err := m.client()
	if err != nil {
		return ExecOpenResult{}, m.mapErr(ep, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	size := client.ConsoleSize{Height: uint(args.Rows), Width: uint(args.Cols)}
	created, err := cli.ExecCreate(ctx, args.ContainerID, client.ExecCreateOptions{
		TTY: true, AttachStdin: true, AttachStdout: true, AttachStderr: true, ConsoleSize: size,
		Cmd: []string{"/bin/sh", "-c", execShell},
	})
	if err != nil {
		cancel()
		return ExecOpenResult{}, m.mapErr(ep, err)
	}
	att, err := cli.ExecAttach(ctx, created.ID, client.ExecAttachOptions{TTY: true, ConsoleSize: size})
	if err != nil {
		cancel()
		return ExecOpenResult{}, m.mapErr(ep, err)
	}
	sess := &execSession{windowKey: args.WindowKey, execID: created.ID, conn: att.HijackedResponse, cancel: cancel}
	if !m.execs.register(args.TerminalID, sess) {
		sess.close()
		return ExecOpenResult{}, ipcerr.New("E_INVALID", "terminal window is closing")
	}
	go m.pumpExec(ctx, cli, args, sess)
	return ExecOpenResult{Shell: "sh"}, nil
}

func (m *Manager) pumpExec(ctx context.Context, cli *client.Client, args ExecOpenArgs, sess *execSession) {
	co := appevent.NewCoalescer(execCoalesce, execCoalesceMax, func(b []byte) int { return len(b) },
		func(batch [][]byte, done bool, final execFinal) {
			var data string
			if len(batch) > 0 {
				var all []byte
				for _, b := range batch {
					all = append(all, b...)
				}
				data = base64.StdEncoding.EncodeToString(all)
			}
			ev := terminal.Event{TerminalID: args.TerminalID, Data: data, Exited: done}
			if done {
				code := final.exitCode
				ev.ExitCode, ev.Error = &code, final.errMsg
			}
			m.Emit.EmitTo(args.WindowKey, ChannelExec, ev)
		})

	buf := make([]byte, 32*1024)
	for {
		n, err := sess.conn.Reader.Read(buf)
		if n > 0 {
			co.Push(append([]byte(nil), buf[:n]...))
		}
		if err != nil {
			break
		}
	}
	final := execFinal{}
	if ctx.Err() == nil {
		ictx, cancel := context.WithTimeout(context.Background(), callTimeout)
		if res, err := cli.ExecInspect(ictx, sess.execID, client.ExecInspectOptions{}); err == nil {
			final.exitCode = res.ExitCode
		} else {
			final.errMsg = err.Error()
		}
		cancel()
	}
	if cur := m.execs.get(args.TerminalID); cur == sess {
		m.execs.take(args.TerminalID)
	}
	sess.close()
	co.Finish(final)
}

func (m *Manager) execWrite(terminalID, dataB64 string) error {
	if terminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return ipcerr.New("E_INVALID", "data must be base64")
	}
	sess := m.execs.get(terminalID)
	if sess == nil {
		return nil
	}
	if _, err := sess.conn.Conn.Write(data); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

func (m *Manager) execResize(ctx context.Context, terminalID string, cols, rows int) error {
	if terminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	if !terminal.ValidDim(cols) || !terminal.ValidDim(rows) {
		return ipcerr.New("E_INVALID", "cols/rows must be within [1, 1000]")
	}
	sess := m.execs.get(terminalID)
	if sess == nil {
		return nil
	}
	return m.call(ctx, callTimeout, func(ctx context.Context, cli *client.Client) error {
		_, err := cli.ExecResize(ctx, sess.execID, client.ExecResizeOptions{Height: uint(rows), Width: uint(cols)})
		return err
	})
}

func (m *Manager) execClose(terminalID string) error {
	if terminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	if sess := m.execs.take(terminalID); sess != nil {
		sess.close()
	}
	return nil
}
