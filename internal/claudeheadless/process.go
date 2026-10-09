package claudeheadless

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kirathecat/kira-studio/internal/loginshell"
	"github.com/kirathecat/kira-studio/internal/procgroup"
)

// maxStreamLine caps one stream-json line; stream-json lines get large (tool results, thinking).
const maxStreamLine = 16 << 20

// gracefulStopDelay is SIGTERM's grace window before SIGKILL; a var so a test can shorten it.
var gracefulStopDelay = 2 * time.Second

var killGroup = procgroup.Kill

// Spec is one headless launch.
type Spec struct {
	// ClaudeBin defaults to "claude" (a test points it at a fake).
	ClaudeBin string
	Dir       string
	// Prompt goes to stdin: variadic flags would swallow a positional prompt, and stdin keeps it off argv.
	Prompt    string
	SessionID string
	// Resume, when set, continues that Claude session (--resume <id>) instead of starting one with
	// SessionID; the session id stays the same.
	Resume        string
	MCPConfigPath string
	// SettingSources is the --setting-sources value ("user" or "user,project,local").
	SettingSources string
	// AllowedTools become --allowedTools; the caller adds the finish_step tool.
	AllowedTools []string
	Timeout      time.Duration
	// Env is the full child environment; nil = os.Environ().
	Env []string
}

// Exit is how the process ended.
type Exit struct {
	Code      int
	TimedOut  bool
	Cancelled bool
}

// Handler receives the parsed output. Its callback may run on any goroutine, never concurrently
// with itself.
type Handler struct {
	OnLine func(Line)
	// OnRateLimits receives the account's rate-limit windows from a rate_limit_event line.
	OnRateLimits func(RateLimits)
}

// quotePOSIX single-quotes s as one shell word.
func quotePOSIX(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// Script is the shell text that execs claude; run under the user's login shell it sees the same
// PATH as the TUI launch. The bearer token lives in the MCP config file, never on argv.
func Script(s Spec) string {
	bin := s.ClaudeBin
	if bin == "" {
		bin = "claude"
	}
	session := []string{"--session-id", quotePOSIX(s.SessionID)}
	if s.Resume != "" {
		session = []string{"--resume", quotePOSIX(s.Resume)}
	}
	words := append([]string{"exec", bin, "-p", "--output-format", "stream-json", "--verbose"}, session...)
	words = append(words, "--mcp-config", quotePOSIX(s.MCPConfigPath), "--setting-sources", quotePOSIX(s.SettingSources))
	if len(s.AllowedTools) > 0 {
		words = append(words, "--allowedTools")
		for _, t := range s.AllowedTools {
			words = append(words, quotePOSIX(t))
		}
	}
	return strings.Join(words, " ")
}

// Run starts claude, feeds the prompt on stdin and streams parsed output to h until it exits.
func Run(ctx context.Context, spec Spec, h Handler) (Exit, error) {
	if spec.Timeout <= 0 {
		return Exit{}, errors.New("claudeheadless: Spec.Timeout must be positive")
	}
	runCtx, cancel := context.WithTimeout(ctx, spec.Timeout)
	defer cancel()

	shell, login := loginshell.ResolveShell(os.Getenv, loginshell.IsExecutableFile)
	argv := loginshell.BuildArgv(shell, login, Script(spec))
	cmd := exec.CommandContext(runCtx, argv[0], argv[1:]...)
	cmd.Dir = spec.Dir
	cmd.Env = spec.Env
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stdin = strings.NewReader(spec.Prompt)
	stopEscalate := procgroup.GracefulCancel(cmd, gracefulStopDelay, killGroup)

	var mu sync.Mutex
	emit := func(l Line) {
		if h.OnLine != nil {
			h.OnLine(l)
		}
	}
	cmd.Stdout = newLineWriter(func(line string) {
		mu.Lock()
		defer mu.Unlock()
		if h.OnRateLimits != nil {
			if rl, ok := parseRateLimits(line); ok {
				h.OnRateLimits(rl)
			}
		}
		for _, l := range parseLine(line) {
			emit(l)
		}
	})
	cmd.Stderr = newLineWriter(func(line string) {
		mu.Lock()
		defer mu.Unlock()
		if strings.TrimSpace(line) != "" {
			emit(Line{StreamStderr, line})
		}
	})

	if err := cmd.Start(); err != nil {
		return Exit{}, err
	}
	waitErr := cmd.Wait()
	stopEscalate()
	cmd.Stdout.(*lineWriter).flush()
	cmd.Stderr.(*lineWriter).flush()

	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	cancelled := !timedOut && ctx.Err() != nil
	if (timedOut || cancelled) && cmd.Process != nil {
		_ = killGroup(cmd.Process.Pid, syscall.SIGKILL)
	}
	exit := Exit{TimedOut: timedOut, Cancelled: cancelled}
	if waitErr == nil {
		return exit, nil
	}
	var exitErr *exec.ExitError
	switch {
	case errors.As(waitErr, &exitErr):
		exit.Code = exitErr.ExitCode()
		return exit, nil
	case errors.Is(waitErr, exec.ErrWaitDelay) && cmd.ProcessState != nil:
		exit.Code = cmd.ProcessState.ExitCode()
		return exit, nil
	case timedOut || cancelled:
		return exit, nil
	}
	return Exit{}, waitErr
}

// lineWriter splits a byte stream into lines; a line over maxStreamLine is cut and marked.
type lineWriter struct {
	mu      sync.Mutex
	buf     []byte
	dropped bool
	onLine  func(string)
}

func newLineWriter(onLine func(string)) *lineWriter { return &lineWriter{onLine: onLine} }

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	var lines []string
	rest := p
	for len(rest) > 0 {
		i := indexNL(rest)
		if i < 0 {
			w.accumulate(rest)
			break
		}
		w.accumulate(rest[:i])
		lines = append(lines, w.take())
		rest = rest[i+1:]
	}
	w.mu.Unlock()
	for _, l := range lines {
		w.onLine(l)
	}
	return len(p), nil
}

func indexNL(b []byte) int {
	for i, c := range b {
		if c == '\n' {
			return i
		}
	}
	return -1
}

func (w *lineWriter) accumulate(b []byte) {
	if w.dropped {
		return
	}
	if len(w.buf)+len(b) > maxStreamLine {
		w.buf = append(w.buf, b[:maxStreamLine-len(w.buf)]...)
		w.dropped = true
		return
	}
	w.buf = append(w.buf, b...)
}

func (w *lineWriter) take() string {
	s := string(w.buf)
	if w.dropped {
		s += "…"
	}
	w.buf, w.dropped = w.buf[:0], false
	return s
}

func (w *lineWriter) flush() {
	w.mu.Lock()
	var line string
	has := len(w.buf) > 0
	if has {
		line = w.take()
	}
	w.mu.Unlock()
	if has {
		w.onLine(line)
	}
}
