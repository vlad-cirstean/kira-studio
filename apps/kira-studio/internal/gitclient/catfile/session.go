// Package catfile is the paged history pipeline's blob/metadata reader (docs/v1.3/plans/G3-
// history-pipeline-and-wire-format.md, D11): two persistent `git cat-file` processes
// (`--batch-check` for metadata-only lookups, `--batch` for content), each driven one request at
// a time by writing a revision per line and reading its two-phase response. Built in this phase;
// its first production caller is G4's commit.detail/commit.fileDiff/blob-read work — RepoEntry
// owns a Session lazily (constructed on first use, torn down with the entry) so a connection that
// never needs it never pays for two extra processes.
package catfile

import (
	"bufio"
	"context"
	"errors"
	"io"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// DefaultMaxBlobBytes bounds how large a blob Read will actually fetch — a size discovered via
// --batch-check that exceeds this is reported as ErrTooLarge without ever asking --batch for the
// content, so a caller can never be handed a multi-gigabyte allocation by surprise.
const DefaultMaxBlobBytes = 10 << 20

// ErrTooLarge is Read's outcome for an object whose size (known from --batch-check, checked
// before any content read) exceeds the session's gate.
var ErrTooLarge = errors.New("catfile: blob exceeds the configured size gate")

// maxConsecutiveFailures bounds the persistent process's own lazy-restart circuit breaker: after
// this many consecutive failures (a spawn failure, or a response readHeader/readContent could not
// parse), further requests fail immediately with errCircuitOpen rather than spawning yet another
// doomed process — a git binary that is simply broken (wrong permissions, corrupt install) must
// not be retried forever.
const maxConsecutiveFailures = 3

var errCircuitOpen = errors.New("catfile: process failed 3 consecutive times, refusing to restart")

// Deps is what a Session needs to spawn its two processes.
type Deps struct {
	Runner  gitclient.Runner
	GitPath string
	Dir     string
}

// persistentProcess is one lazily-started, long-lived `git cat-file` child, driven one request at
// a time under its own mutex (upstream's own #pump — "one request in flight" — made explicit as
// the lock every request call holds for its whole write+read). It is spawned against a long-lived
// context owned by the Session (never a single request's own ctx): gitclient.Runner ties process
// lifetime to the context passed to Start, and a persistent process must outlive any one request.
type persistentProcess struct {
	runner   gitclient.Runner
	gitPath  string
	dir      string
	args     []string
	spawnCtx context.Context

	mu       sync.Mutex
	proc     gitclient.Process
	stdin    io.WriteCloser
	reader   *bufio.Reader
	failures int
}

// ensureStarted lazily spawns the child. Caller holds mu.
func (p *persistentProcess) ensureStarted() error {
	if p.proc != nil {
		return nil
	}
	if p.failures >= maxConsecutiveFailures {
		return errCircuitOpen
	}
	proc, err := p.runner.Start(p.spawnCtx, p.gitPath, gitclient.Spec{
		Dir: p.dir, Args: p.args, ReadOnly: true, Stdin: true,
	})
	if err != nil {
		p.failures++
		return err
	}
	p.proc = proc
	p.stdin = proc.Stdin()
	p.reader = bufio.NewReader(proc.Stdout())
	return nil
}

// fail tears the current child down (a queued request behind this one, or the next call, gets a
// fresh spawn attempt rather than hanging against a process that has already gone bad) and counts
// toward the circuit breaker. Caller holds mu.
func (p *persistentProcess) fail() {
	if p.proc != nil {
		_ = p.proc.Close()
	}
	p.proc, p.stdin, p.reader = nil, nil, nil
	p.failures++
}

// request writes line to the child's stdin and hands its stdout reader to readResp — the whole
// call runs under mu, which is what makes "one request in flight" true regardless of how many
// goroutines call request concurrently: they queue on the lock, FIFO. readResp must return a
// non-nil error only for a genuine protocol/IO failure — a normal "object missing" answer is not
// one (readHeader itself returns found=false, err=nil for it), so a missing lookup never trips
// the circuit breaker.
func (p *persistentProcess) request(line string, readResp func(*bufio.Reader) error) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureStarted(); err != nil {
		return err
	}
	if _, err := io.WriteString(p.stdin, line); err != nil {
		p.fail()
		return err
	}
	if err := readResp(p.reader); err != nil {
		p.fail()
		return err
	}
	p.failures = 0
	return nil
}

func (p *persistentProcess) close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.proc != nil {
		_ = p.proc.Close()
	}
	p.proc, p.stdin, p.reader = nil, nil, nil
}

// Session is the `--batch-check`/`--batch` pair, lazily started, driven by revision strings.
type Session struct {
	maxBlobBytes int64
	check        *persistentProcess
	batch        *persistentProcess
	cancelSpawn  context.CancelFunc
}

// NewSession constructs a Session over deps — nothing is spawned until the first Check/Read.
// maxBlobBytes <= 0 defaults to DefaultMaxBlobBytes.
func NewSession(deps Deps, maxBlobBytes int64) *Session {
	if maxBlobBytes <= 0 {
		maxBlobBytes = DefaultMaxBlobBytes
	}
	spawnCtx, cancel := context.WithCancel(context.Background())
	return &Session{
		maxBlobBytes: maxBlobBytes,
		check: &persistentProcess{
			runner: deps.Runner, gitPath: deps.GitPath, dir: deps.Dir,
			args: []string{"cat-file", "--batch-check"}, spawnCtx: spawnCtx,
		},
		batch: &persistentProcess{
			runner: deps.Runner, gitPath: deps.GitPath, dir: deps.Dir,
			args: []string{"cat-file", "--batch"}, spawnCtx: spawnCtx,
		},
		cancelSpawn: cancel,
	}
}

// Check resolves rev via --batch-check alone — no content is ever read. Returns ErrMissing when
// git could not resolve rev.
func (s *Session) Check(rev string) (ObjectInfo, error) {
	var info ObjectInfo
	var found bool
	err := s.check.request(rev+"\n", func(r *bufio.Reader) error {
		var rerr error
		info, found, rerr = readHeader(r)
		return rerr
	})
	if err != nil {
		return ObjectInfo{}, err
	}
	if !found {
		return ObjectInfo{}, ErrMissing
	}
	return info, nil
}

// Read resolves rev and returns its content. Checks the size via --batch-check first (Check) and
// answers ErrTooLarge without ever asking --batch for the bytes when it exceeds the session's
// gate — the size gate this session was built to enforce.
func (s *Session) Read(rev string) (ObjectInfo, []byte, error) {
	info, err := s.Check(rev)
	if err != nil {
		return ObjectInfo{}, nil, err
	}
	if info.Size > s.maxBlobBytes {
		return info, nil, ErrTooLarge
	}

	var content []byte
	var found bool
	var batchInfo ObjectInfo
	err = s.batch.request(rev+"\n", func(r *bufio.Reader) error {
		var rerr error
		batchInfo, found, rerr = readHeader(r)
		if rerr != nil || !found {
			return rerr
		}
		content, rerr = readContent(r, batchInfo.Size)
		return rerr
	})
	if err != nil {
		return ObjectInfo{}, nil, err
	}
	if !found {
		return ObjectInfo{}, nil, ErrMissing
	}
	return batchInfo, content, nil
}

// Close stops both persistent processes. Idempotent.
func (s *Session) Close() {
	s.cancelSpawn()
	s.check.close()
	s.batch.close()
}
