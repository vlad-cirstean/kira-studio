// Package logsession is the paged history walk (docs/v1.3/plans/G3-history-pipeline-and-wire-
// format.md, D10): a paused, resumable `git log` process. A page's own limit IS the pause — the
// read loop simply stops calling Read on the child's stdout once a page is full, and git's own
// write() blocks against the now-unread OS pipe, holding the process (and its walk position)
// exactly where the caller left it, with no explicit protocol needed to say "pause" or "resume".
package logsession

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// DefaultPageSize is upstream's own default (logSession.ts's DEFAULT_PAGE_SIZE).
const DefaultPageSize = 5000

// defaultIdleReclaim is the deliberate departure from upstream's own knob (F10/D10): a
// per-connection walk (SPEC §6/G3 D13/F9) multiplies the number of paused, held-open `git log`
// processes by the number of open windows, so unlike upstream (which never switches its own
// idleReclaimMs on) this backend reclaims one after 5 minutes idle — matching
// gitsession.defaultLingerFor, so a walk's process and its RepoEntry age out on the same clock.
const defaultIdleReclaim = 5 * time.Minute

// readChunkSize bounds one raw Read off the child's stdout pipe.
const readChunkSize = 64 * 1024

// Deps is what a Session needs to spawn processes and run bounded, ordinary reads. Read is
// (*gitclient.Repo).Read, injected rather than imported so this package needs no registry to be
// testable, and so D10's split ("short spawns through the gate, the paused one direct") is
// visible in the type: the paused `git log` itself is spawned through Runner directly, never
// through Read.
type Deps struct {
	Runner  gitclient.Runner
	GitPath string
	Dir     string
	Read    func(ctx context.Context, fn func(ctx context.Context) error) error
}

// Options configures one Session.
type Options struct {
	Walk porcelain.WalkSpec
	// PageSize <= 0 -> DefaultPageSize.
	PageSize int
	// IdleReclaim == 0 -> defaultIdleReclaim; < 0 -> never reclaim (test-only in practice).
	IdleReclaim time.Duration
	// PrecomputedTotal, when set, short-circuits Remaining's own rev-list --count — G6's ranged
	// walk supplies this from a count it already has; G3 never sets it.
	PrecomputedTotal *int
}

// Outcome is one ReadPage call's result.
type Outcome struct {
	Appended  int
	Exhausted bool
	// Stale is true when a reclaimed session's resume found the ref snapshot had moved since the
	// walk began — the page arithmetic (a --skip resume assumes the same rev set in the same
	// order) is no longer trustworthy, and the caller must reset and retry (a fresh Session).
	Stale bool
}

// Session is one paged, resumable `git log` walk.
type Session struct {
	deps Deps
	opts Options

	spawnCtx    context.Context
	cancelSpawn context.CancelFunc

	mu          sync.Mutex
	proc        gitclient.Process
	splitter    *porcelain.RecordSplitter
	currentArgs []string
	pending     []porcelain.CommitRecord // parsed but not yet delivered to a caller (F13)
	loadedCount int
	// readCount is how many records have been *consumed from the process's own output stream* —
	// delivered to a caller or merely parsed into pending, either way. This, not loadedCount, is
	// the correct --skip offset on a reclaimed resume: a chunk read can parse more records than
	// one page needs (the rest queue into pending), so by the time a resume happens the process
	// may already have produced records loadedCount never counted — resuming at loadedCount would
	// re-walk and re-queue those same records a second time.
	readCount    int
	exhausted    bool
	baseSnapshot map[string]string // refname -> object id, captured before the first spawn (D9)
	reclaimTimer *time.Timer
	cachedTotal  *int
}

// Open constructs a Session. Nothing is spawned until the first ReadPage.
func Open(deps Deps, opts Options) *Session {
	if opts.PageSize <= 0 {
		opts.PageSize = DefaultPageSize
	}
	if opts.IdleReclaim == 0 {
		opts.IdleReclaim = defaultIdleReclaim
	}
	spawnCtx, cancel := context.WithCancel(context.Background())
	return &Session{deps: deps, opts: opts, spawnCtx: spawnCtx, cancelSpawn: cancel}
}

// ReadPage reads up to one page's worth of records, calling sink for each in walk order. A page
// that fills mid-read carries whatever was already parsed but not yet delivered forward to the
// next ReadPage call — never dropped (F13).
func (s *Session) ReadPage(ctx context.Context, sink func(porcelain.CommitRecord)) (Outcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.disarmReclaimLocked()

	if s.exhausted {
		return Outcome{Exhausted: true}, nil
	}

	if s.proc == nil {
		stale, err := s.spawnOrResumeLocked(ctx)
		if err != nil {
			return Outcome{}, err
		}
		if stale {
			return Outcome{Stale: true}, nil
		}
	}

	pageSize := s.opts.PageSize
	appended := 0

	for len(s.pending) > 0 && appended < pageSize {
		sink(s.pending[0])
		s.pending = s.pending[1:]
		appended++
		s.loadedCount++
	}

	for appended < pageSize {
		chunk, readErr := s.readChunkLocked(ctx)
		if len(chunk) > 0 {
			recs, splitErr := s.splitter.Push(chunk)
			if splitErr != nil {
				return Outcome{}, splitErr
			}
			for _, rec := range recs {
				cr, parseErr := porcelain.ParseLogRecord(rec)
				if parseErr != nil {
					return Outcome{}, parseErr
				}
				s.readCount++
				if appended < pageSize {
					sink(cr)
					appended++
					s.loadedCount++
				} else {
					s.pending = append(s.pending, cr)
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				if flushed := s.splitter.Flush(); len(flushed) > 0 {
					return Outcome{}, fmt.Errorf("logsession: unterminated trailing record at EOF (%d bytes)", len(flushed))
				}
				res, waitErr := s.proc.Wait()
				s.proc = nil
				if waitErr != nil {
					return Outcome{}, waitErr
				}
				if cerr := gitclient.Classify(ctx, s.currentArgs, res, nil); cerr != nil {
					return Outcome{}, cerr
				}
				s.exhausted = true
				break
			}
			return Outcome{}, readErr
		}
	}

	if !s.exhausted {
		s.armReclaimLocked()
	}

	return Outcome{Appended: appended, Exhausted: s.exhausted}, nil
}

// spawnOrResumeLocked starts the walk (readCount == 0) or resumes a reclaimed one (via --skip),
// guarded by comparing the current ref snapshot against the one captured before the very first
// spawn — the walk's whole rev set and order must still match for --skip's row arithmetic to be
// valid. Caller holds mu.
func (s *Session) spawnOrResumeLocked(ctx context.Context) (stale bool, err error) {
	snap, err := s.snapshot(ctx)
	if err != nil {
		return false, err
	}

	var args []string
	if s.readCount == 0 {
		s.baseSnapshot = snap
		args = porcelain.LogSessionArgs(s.opts.Walk)
	} else {
		if !refsEqual(s.baseSnapshot, snap) {
			return true, nil
		}
		args = porcelain.LogSessionSkipArgs(s.opts.Walk, s.readCount)
	}

	proc, err := s.deps.Runner.Start(s.spawnCtx, s.deps.GitPath, gitclient.Spec{Dir: s.deps.Dir, Args: args, ReadOnly: true})
	if err != nil {
		return false, err
	}
	s.proc = proc
	s.currentArgs = args
	s.splitter = porcelain.NewRecordSplitter(0)
	return false, nil
}

// readChunkLocked reads one raw chunk off the current process's stdout, cancellable by ctx — a
// cancelled ctx kills the child (Process.Close) and returns promptly rather than leaving the read
// (and the caller) blocked indefinitely.
func (s *Session) readChunkLocked(ctx context.Context) ([]byte, error) {
	type result struct {
		b   []byte
		err error
	}
	stdout := s.proc.Stdout()
	ch := make(chan result, 1)
	go func() {
		buf := make([]byte, readChunkSize)
		n, err := stdout.Read(buf)
		ch <- result{b: buf[:n], err: err}
	}()
	select {
	case r := <-ch:
		return r.b, r.err
	case <-ctx.Done():
		_ = s.proc.Close()
		s.proc = nil
		return nil, ctx.Err()
	}
}

func (s *Session) snapshot(ctx context.Context) (map[string]string, error) {
	args := porcelain.RefSnapshotArgs()
	var stdout []byte
	err := s.deps.Read(ctx, func(ctx context.Context) error {
		res, runErr := gitclient.Run(ctx, s.deps.Runner, s.deps.GitPath, gitclient.Spec{Dir: s.deps.Dir, Args: args, ReadOnly: true})
		if cerr := gitclient.Classify(ctx, args, res, runErr); cerr != nil {
			return cerr
		}
		stdout = res.Stdout
		return nil
	})
	if err != nil {
		return nil, err
	}
	return porcelain.ParseRefSnapshot(stdout)
}

func refsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// Remaining is one `rev-list --count` over the same rev set as the walk, cached for the life of
// this Session (a Session that outlives a ref change is discarded by its caller, D13 — the cache
// never needs to be invalidated from inside this package).
func (s *Session) Remaining(ctx context.Context) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.opts.PrecomputedTotal != nil {
		remaining := *s.opts.PrecomputedTotal - s.loadedCount
		if remaining < 0 {
			remaining = 0
		}
		return remaining, nil
	}
	if s.cachedTotal == nil {
		total, err := s.countTotal(ctx)
		if err != nil {
			return 0, err
		}
		s.cachedTotal = &total
	}
	remaining := *s.cachedTotal - s.loadedCount
	if remaining < 0 {
		remaining = 0
	}
	return remaining, nil
}

func (s *Session) countTotal(ctx context.Context) (int, error) {
	args := append([]string{"rev-list", "--count"}, porcelain.WalkArgs(s.opts.Walk)...)
	var total int
	err := s.deps.Read(ctx, func(ctx context.Context) error {
		res, runErr := gitclient.Run(ctx, s.deps.Runner, s.deps.GitPath, gitclient.Spec{Dir: s.deps.Dir, Args: args, ReadOnly: true})
		if cerr := gitclient.Classify(ctx, args, res, runErr); cerr != nil {
			return cerr
		}
		n, perr := strconv.Atoi(strings.TrimSpace(string(res.Stdout)))
		if perr != nil {
			return fmt.Errorf("logsession: rev-list --count: unparseable output %q: %w", res.Stdout, perr)
		}
		total = n
		return nil
	})
	return total, err
}

func (s *Session) LoadedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadedCount
}

func (s *Session) Exhausted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exhausted
}

// armReclaimLocked arms the idle-reclaim timer (unless IdleReclaim < 0, "never"). Caller holds mu.
func (s *Session) armReclaimLocked() {
	if s.opts.IdleReclaim < 0 {
		return
	}
	s.reclaimTimer = time.AfterFunc(s.opts.IdleReclaim, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.proc != nil {
			_ = s.proc.Close()
			s.proc = nil
		}
	})
}

func (s *Session) disarmReclaimLocked() {
	if s.reclaimTimer != nil {
		s.reclaimTimer.Stop()
		s.reclaimTimer = nil
	}
}

// Close stops the session's process (if any) and its reclaim timer. Idempotent.
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.disarmReclaimLocked()
	s.cancelSpawn()
	if s.proc != nil {
		_ = s.proc.Close()
		s.proc = nil
	}
}
