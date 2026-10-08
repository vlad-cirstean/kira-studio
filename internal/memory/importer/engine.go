package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cenkalti/backoff/v4"
	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"

	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/memory"
)

const (
	maxRetries       = 3
	maxPaths         = 100
	maxFinalizeToken = 80000
)

// Options configure an Engine. Only Agent is required.
type Options struct {
	Agent      Agent
	Extractors int                    // concurrent extract calls; 0 means 3
	Backoff    func() backoff.BackOff // per-item retry schedule; nil means exponential from 10 s
	OnChange   func()                 // runs after any state change; must not block
	Now        func() time.Time
	Caps       Caps   // zero means DefaultCaps
	Budget     Budget // zero means DefaultBudget
}

func defaultBackoff() backoff.BackOff {
	b := backoff.NewExponentialBackOff()
	b.InitialInterval = 10 * time.Second
	b.Multiplier = 2
	b.MaxInterval = 2 * time.Minute
	b.RandomizationFactor = 0.5
	b.MaxElapsedTime = 0
	return b
}

type armedJob struct {
	ctx    context.Context
	cancel context.CancelFunc
}

// Engine runs bulk imports. All state lives in memory.db, so a halted engine resumes from disk.
type Engine struct {
	st     *store
	agent  Agent
	opts   Options
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
	wake   chan struct{}

	extractSem *semaphore.Weighted
	finalizing atomic.Bool
	closeOnce  sync.Once

	mu        sync.Mutex
	armed     map[string]armedJob // running jobs' contexts
	notBefore time.Time           // shared rate-limit cooldown
}

// Open resets anything a crash or quit left mid-flight (running jobs become paused) and starts the
// scheduler. It never resumes a job by itself.
func Open(ms *memory.Store, opts Options) (*Engine, error) {
	if opts.Agent == nil {
		return nil, errors.New("importer: agent required")
	}
	if opts.Extractors <= 0 {
		opts.Extractors = 3
	}
	if opts.Backoff == nil {
		opts.Backoff = defaultBackoff
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.Caps == (Caps{}) {
		opts.Caps = DefaultCaps
	}
	if opts.Budget == (Budget{}) {
		opts.Budget = DefaultBudget
	}
	db, err := ms.DB()
	if err != nil {
		return nil, err
	}
	st := &store{db: db, now: func() string { return kiratime.FormatISO(opts.Now()) }}
	if err := st.recoverInterrupted(); err != nil {
		return nil, fmt.Errorf("importer: recover: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{
		st: st, agent: opts.Agent, opts: opts, ctx: ctx, cancel: cancel, wake: make(chan struct{}, 1),
		extractSem: semaphore.NewWeighted(int64(opts.Extractors)), armed: map[string]armedJob{},
	}
	e.wg.Add(1)
	go e.loop()
	return e, nil
}

// Close stops all work, waits for it, and leaves the rows as a restart expects them: running jobs
// paused as interrupted, in-flight chunks pending again.
func (e *Engine) Close() error {
	var err error
	e.closeOnce.Do(func() {
		e.cancel()
		e.wg.Wait()
		err = e.st.recoverInterrupted()
	})
	return err
}

func (e *Engine) changed() {
	if e.opts.OnChange != nil {
		e.opts.OnChange()
	}
}

func (e *Engine) kick() {
	select {
	case e.wake <- struct{}{}:
	default:
	}
}

// arm gives a job the context its in-flight calls run under. Pause, cancel and finish disarm it,
// which kills those calls.
func (e *Engine) arm(jobID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := e.armed[jobID]; !ok {
		ctx, cancel := context.WithCancel(e.ctx)
		e.armed[jobID] = armedJob{ctx: ctx, cancel: cancel}
	}
}

func (e *Engine) disarm(jobID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if a, ok := e.armed[jobID]; ok {
		a.cancel()
		delete(e.armed, jobID)
	}
}

func (e *Engine) jobCtx(jobID string) (context.Context, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	a, ok := e.armed[jobID]
	return a.ctx, ok
}

func (e *Engine) armIfRunning(jobID string) {
	if d, err := e.st.jobDetail(jobID); err == nil && d.Job.State == JobRunning {
		e.arm(jobID)
	}
}

// Create scans paths (files and folders) in the background; the job reaches awaiting when the
// scan ends. Nothing runs until Start.
func (e *Engine) Create(paths []string) (Job, error) {
	if n := len(paths); n < 1 || n > maxPaths {
		return Job{}, fmt.Errorf("%w: pick 1 to %d files or folders", memory.ErrInvalid, maxPaths)
	}
	id := uuid.NewString()
	if err := e.st.insertJob(id, paths); err != nil {
		return Job{}, err
	}
	e.wg.Add(1)
	go e.scan(id, paths)
	e.changed()
	d, err := e.st.jobDetail(id)
	return d.Job, err
}

func (e *Engine) scan(id string, paths []string) {
	defer e.wg.Done()
	defer e.changed()
	res, err := Scan(e.ctx, paths, e.opts.Caps)
	if err != nil {
		if e.ctx.Err() == nil {
			slog.Warn("memory import: scan failed", "err", err)
			_ = e.st.failScan(id, err.Error())
		}
		return
	}
	files, err := e.plan(res)
	if err == nil {
		err = e.st.scanned(id, res.Base, res.Truncated, res.Ignored, files)
	}
	if err != nil && e.ctx.Err() == nil {
		slog.Warn("memory import: scan failed", "err", err)
		_ = e.st.failScan(id, err.Error())
	}
}

// plan turns a scan into file rows: duplicates and already imported content are skipped with a
// reason, the rest are chunked once to size the job.
func (e *Engine) plan(res ScanResult) ([]newFile, error) {
	files := make([]newFile, 0, len(res.Files)+len(res.Skipped))
	for _, sk := range res.Skipped {
		files = append(files, newFile{ID: uuid.NewString(), Path: sk.Path, Rel: sk.Rel, Kind: orKind(sk.Kind), Size: sk.Size,
			State: FileSkipped, Reason: sk.Reason})
	}
	first := map[string]string{}
	for _, c := range res.Files {
		nf := newFile{ID: uuid.NewString(), Path: c.Path, Rel: c.Rel, Kind: c.Kind, Size: c.Size, Hash: c.Hash, State: FileSkipped}
		if other, dup := first[c.Hash]; dup {
			nf.Reason = "same content as " + other
			files = append(files, nf)
			continue
		}
		first[c.Hash] = c.Rel
		at, done, err := e.st.doneHash(c.Hash)
		if err != nil {
			return nil, err
		}
		if done {
			nf.Reason = "unchanged since import on " + strings.SplitN(at, "T", 2)[0]
			files = append(files, nf)
			continue
		}
		text, _, reason, err := ReadText(c.Path, e.opts.Caps.MaxFileBytes)
		if err != nil || reason != "" {
			nf.Reason = orReason(reason, err)
			files = append(files, nf)
			continue
		}
		chunks, title := chunkFile(c.Kind, text, c.Rel, e.opts.Budget)
		nf.State, nf.Title, nf.Chunks = FilePending, title, len(chunks)
		for _, ch := range chunks {
			nf.Tokens += ch.Tokens
		}
		files = append(files, nf)
	}
	return files, nil
}

func orKind(k string) string {
	if k == "" {
		return KindText
	}
	return k
}

func orReason(reason string, err error) string {
	if reason != "" {
		return reason
	}
	return "unreadable: " + err.Error()
}

func chunkFile(kind, text, rel string, b Budget) ([]Chunk, string) {
	var chunks []Chunk
	title := ""
	if kind == KindMarkdown {
		chunks, title = ChunkMarkdown(text, b)
	} else {
		chunks = ChunkText(text, b)
	}
	if title == "" {
		name := path.Base(filepath.ToSlash(rel))
		title = strings.TrimSuffix(name, path.Ext(name))
	}
	return chunks, title
}

// Start begins an awaiting job.
func (e *Engine) Start(id string) error {
	if err := e.agent.Available(); err != nil {
		return err
	}
	e.arm(id)
	if err := e.st.startJob(id); err != nil {
		e.disarm(id)
		return err
	}
	e.changed()
	e.kick()
	return e.settle(id)
}

// Resume continues a paused job.
func (e *Engine) Resume(id string) error {
	if err := e.agent.Available(); err != nil {
		return err
	}
	e.arm(id)
	if err := e.st.resumeJob(id); err != nil {
		e.disarm(id)
		return err
	}
	e.changed()
	e.kick()
	return e.settle(id)
}

// Pause stops a running job; in-flight calls are killed and their chunks go back to pending.
func (e *Engine) Pause(id string) error {
	if err := e.st.pause(id, "Paused"); err != nil {
		return err
	}
	e.disarm(id)
	e.changed()
	return nil
}

// Cancel ends a running or paused job for good. Stored memories stay.
func (e *Engine) Cancel(id string) error {
	if err := e.st.cancelJob(id); err != nil {
		return err
	}
	e.disarm(id)
	e.changed()
	return nil
}

// Discard deletes an awaiting job without running it.
func (e *Engine) Discard(id string) error {
	if err := e.st.discardJob(id); err != nil {
		return err
	}
	e.changed()
	return nil
}

// Dismiss hides a finished job from the list. Its files still count for unchanged detection.
func (e *Engine) Dismiss(id string) error {
	if err := e.st.dismissJob(id); err != nil {
		return err
	}
	e.changed()
	return nil
}

// RetryFailed retries every failed file of a job.
func (e *Engine) RetryFailed(id string) error {
	if err := e.agent.Available(); err != nil {
		return err
	}
	if _, err := e.st.retryFailed(id); err != nil {
		return err
	}
	e.armIfRunning(id)
	e.changed()
	e.kick()
	return nil
}

// RetryFile retries one failed file: only its failed chunks rerun, or only the store step.
func (e *Engine) RetryFile(fileID string) error {
	if err := e.agent.Available(); err != nil {
		return err
	}
	jobID, err := e.st.retryFile(fileID)
	if err != nil {
		return err
	}
	e.armIfRunning(jobID)
	e.changed()
	e.kick()
	return nil
}

func (e *Engine) Jobs() ([]Job, error)             { return e.st.listJobs() }
func (e *Engine) Job(id string) (JobDetail, error) { return e.st.jobDetail(id) }

func (e *Engine) loop() {
	defer e.wg.Done()
	for {
		e.schedule()
		select {
		case <-e.ctx.Done():
			return
		case <-e.wake:
		}
	}
}

// schedule starts as much work as the slots allow: extract workers for pending chunks (reading and
// chunking the next file when none is pending) and the single finalize worker.
func (e *Engine) schedule() {
	for e.ctx.Err() == nil && e.extractSem.TryAcquire(1) {
		it, ok, err := e.st.claimChunk()
		if err != nil {
			e.extractSem.Release(1)
			slog.Error("memory import: claim chunk", "err", err)
			break
		}
		if !ok {
			e.extractSem.Release(1)
			progressed, err := e.materialiseNext()
			if err != nil {
				slog.Error("memory import: materialise", "err", err)
				break
			}
			if progressed {
				continue
			}
			break
		}
		ctx, armed := e.jobCtx(it.JobID)
		if !armed {
			_ = e.st.releaseChunk(it, usage{})
			e.extractSem.Release(1)
			break
		}
		e.wg.Add(1)
		go e.runExtract(ctx, it)
	}
	if e.ctx.Err() == nil && e.finalizing.CompareAndSwap(false, true) {
		it, ok, err := e.st.claimFinalize()
		if err != nil || !ok {
			e.finalizing.Store(false)
			if err != nil {
				slog.Error("memory import: claim finalize", "err", err)
			}
			return
		}
		ctx, armed := e.jobCtx(it.JobID)
		if !armed {
			_ = e.st.releaseFinalize(it, usage{})
			e.finalizing.Store(false)
			return
		}
		e.wg.Add(1)
		go e.runFinalize(ctx, it)
	}
}

// materialiseNext reads, validates, hashes and chunks the next pending file. It reports whether it
// changed anything, so the scheduler asks again.
func (e *Engine) materialiseNext() (bool, error) {
	ref, ok, err := e.st.nextPendingFile()
	if err != nil || !ok {
		return false, err
	}
	defer e.changed()
	end := func(state, reason string) (bool, error) {
		err := e.st.endFile(ref.FileID, []string{FileExtracting}, state, reason)
		if err == nil {
			err = e.settle(ref.JobID)
		}
		return true, err
	}
	text, hash, skip, err := ReadText(ref.Path, e.opts.Caps.MaxFileBytes)
	switch {
	case err != nil:
		return end(FileFailed, "Cannot read file: "+err.Error())
	case skip != "":
		return end(FileSkipped, skip)
	}
	if at, done, err := e.st.doneHash(hash); err != nil {
		return false, err
	} else if done {
		return end(FileSkipped, "unchanged since import on "+strings.SplitN(at, "T", 2)[0])
	}
	chunks, title := chunkFile(ref.Kind, text, ref.Rel, e.opts.Budget)
	if len(chunks) == 0 {
		return end(FileSkipped, "empty")
	}
	return true, e.st.storeChunks(ref.FileID, hash, title, chunks)
}

// settle finishes a job whose files are all terminal.
func (e *Engine) settle(jobID string) error {
	done, err := e.st.finishJobIfIdle(jobID)
	if done {
		e.disarm(jobID)
	}
	return err
}

func isFatal(err error) bool {
	return errors.Is(err, memory.ErrClaudeNotFound) || errors.Is(err, memory.ErrClaudeAuth) ||
		errors.Is(err, memory.ErrClaudeOutdated) || errors.Is(err, memory.ErrClaudeUsageLimit)
}

// retry runs op with exponential backoff. Fatal errors, a spent budget and a cancelled context
// stop at once; a rate limit also holds every other worker back until its wait is over.
func (e *Engine) retry(ctx context.Context, op func() error) error {
	bo := backoff.WithContext(backoff.WithMaxRetries(e.opts.Backoff(), maxRetries), ctx)
	return backoff.RetryNotify(func() error {
		if err := e.waitCooldown(ctx); err != nil {
			return backoff.Permanent(err)
		}
		err := op()
		if err == nil {
			return nil
		}
		if ctx.Err() != nil || isFatal(err) || errors.Is(err, memory.ErrClaudeBudget) {
			return backoff.Permanent(err)
		}
		return err
	}, bo, func(err error, next time.Duration) {
		if errors.Is(err, memory.ErrClaudeRateLimited) {
			e.cooldown(next)
		}
		slog.Warn("memory import: retrying", "err", err, "in", next)
	})
}

func (e *Engine) cooldown(d time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if until := time.Now().Add(d); until.After(e.notBefore) {
		e.notBefore = until
	}
}

func (e *Engine) waitCooldown(ctx context.Context) error {
	for {
		e.mu.Lock()
		wait := time.Until(e.notBefore)
		e.mu.Unlock()
		if wait <= 0 {
			return ctx.Err()
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return ctx.Err()
		case <-t.C:
		}
	}
}

func (e *Engine) pauseFatal(jobID string, err error) {
	if paused, perr := e.st.pauseIfRunning(jobID, err.Error()); perr != nil {
		slog.Error("memory import: pause", "err", perr)
	} else if paused {
		e.disarm(jobID)
	}
}

func (e *Engine) runExtract(ctx context.Context, it chunkItem) {
	defer e.wg.Done()
	defer e.kick()
	defer e.extractSem.Release(1)
	defer e.changed()

	var u usage
	var out ExtractOutput
	tries := 0
	runErr := e.retry(ctx, func() error {
		tries++
		u.Calls++
		o, err := e.agent.Extract(ctx, ExtractInput{Path: it.Path, Title: it.Title, Index: it.Index, Count: it.Count,
			HeadingPath: it.HeadingPath, Context: it.Context, Text: it.Text})
		u.CostUSD += o.CostUSD
		if err == nil {
			out = o
		}
		return err
	})
	var err error
	switch {
	case runErr == nil:
		err = e.st.finishChunk(it, out.Facts, tries, u)
	case ctx.Err() != nil:
		err = e.st.releaseChunk(it, u)
	case isFatal(runErr):
		err = e.st.releaseChunk(it, u)
		e.pauseFatal(it.JobID, runErr)
	default:
		err = e.st.failChunk(it, boundedMessage(runErr), tries, u)
	}
	if err == nil {
		err = e.settle(it.JobID)
	}
	if err != nil {
		slog.Error("memory import: extract result", "err", err)
	}
}

func boundedMessage(err error) string {
	msg := strings.TrimSpace(err.Error())
	if r := []rune(msg); len(r) > 300 {
		msg = string(r[:300]) + "..."
	}
	return msg
}

func (e *Engine) runFinalize(ctx context.Context, it finalItem) {
	defer e.wg.Done()
	defer e.kick()
	defer e.finalizing.Store(false)
	defer e.changed()

	var u usage
	var err error
	switch {
	case len(it.Facts) == 0:
		err = e.st.finishFile(it, FinalizeOutput{}, u)
	case tooManyFacts(it.Facts):
		err = e.st.failFinalize(it, fmt.Sprintf("Too many facts (%d) for one pass. Split the file.", len(it.Facts)), u)
	default:
		var out FinalizeOutput
		runErr := e.retry(ctx, func() error {
			u.Calls++
			o, err := e.agent.Finalize(ctx, FinalizeInput{FileID: it.FileID, Path: it.Path, Title: it.Title,
				ChunkCount: it.ChunkCount, Facts: it.Facts})
			u.CostUSD += o.CostUSD
			if err == nil {
				out = o
			}
			return err
		})
		switch {
		case runErr == nil:
			err = e.st.finishFile(it, out, u)
		case ctx.Err() != nil:
			err = e.st.releaseFinalize(it, u)
		case isFatal(runErr):
			err = e.st.releaseFinalize(it, u)
			e.pauseFatal(it.JobID, runErr)
		default:
			err = e.st.failFinalize(it, boundedMessage(runErr), u)
		}
	}
	if err == nil {
		err = e.settle(it.JobID)
	}
	if err != nil {
		slog.Error("memory import: finalize result", "err", err)
	}
}

// tooManyFacts guards the step-2 prompt size; a file over it fails instead of being truncated.
func tooManyFacts(facts []FinalFact) bool {
	raw, _ := json.Marshal(facts)
	return EstimateTokens(string(raw)) > maxFinalizeToken
}
