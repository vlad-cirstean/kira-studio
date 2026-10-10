package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cenkalti/backoff/v4"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func TestMain(m *testing.M) { os.Exit(testx.RunWithTempHomes(m)) }

// acceptRunner approves every gated fact and adds every reconciled one.
type acceptRunner struct{}

func (acceptRunner) Run(_ context.Context, c memory.Call) (json.RawMessage, error) {
	var rec struct{ Facts []struct{ Index int } }
	if json.Unmarshal([]byte(c.Input), &rec) == nil && len(rec.Facts) > 0 {
		ds := []map[string]any{}
		for _, f := range rec.Facts {
			ds = append(ds, map[string]any{"index": f.Index, "action": "add", "target": "", "fact": "", "reason": "", "why": "new"})
		}
		return json.Marshal(map[string]any{"decisions": ds})
	}
	var in struct {
		Items []struct {
			Index        int
			Fact, Reason string
		}
	}
	if err := json.Unmarshal([]byte(c.Input), &in); err != nil || len(in.Items) == 0 {
		return nil, memory.ErrClaudeOutput
	}
	items := []map[string]any{}
	for _, it := range in.Items {
		items = append(items, map[string]any{"index": it.Index, "verdict": "accept", "questions": []string{},
			"facts": []map[string]any{{"fact": it.Fact, "reason": it.Reason, "keywords": []string{"kw"}}}})
	}
	return json.Marshal(map[string]any{"items": items})
}

type fakeAgent struct {
	svc *memory.Service

	mu          sync.Mutex
	extractHook func(ctx context.Context, in ExtractInput) error
	finalHook   func(ctx context.Context, in FinalizeInput) error
	extracted   map[string]int // "rel#idx" -> successful calls
	extractRuns int
	finalInputs []FinalizeInput
	curExtract  int
	maxExtract  int
	curFinal    int
	maxFinal    int
}

func (a *fakeAgent) Available() error { return nil }

func (a *fakeAgent) Extract(ctx context.Context, in ExtractInput) (ExtractOutput, error) {
	a.mu.Lock()
	a.extractRuns++
	a.curExtract++
	a.maxExtract = max(a.maxExtract, a.curExtract)
	hook := a.extractHook
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.curExtract--; a.mu.Unlock() }()
	if hook != nil {
		if err := hook(ctx, in); err != nil {
			return ExtractOutput{}, err
		}
	}
	a.mu.Lock()
	if a.extracted == nil {
		a.extracted = map[string]int{}
	}
	a.extracted[fmt.Sprintf("%s#%d", in.Path, in.Index)]++
	a.mu.Unlock()
	return ExtractOutput{Facts: []Fact{{Fact: fmt.Sprintf("%s says part %d", in.Title, in.Index), Evidence: "e", Section: in.HeadingPath}}, CostUSD: 0.01}, nil
}

func (a *fakeAgent) Finalize(ctx context.Context, in FinalizeInput) (FinalizeOutput, error) {
	a.mu.Lock()
	a.curFinal++
	a.maxFinal = max(a.maxFinal, a.curFinal)
	a.finalInputs = append(a.finalInputs, in)
	hook := a.finalHook
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.curFinal--; a.mu.Unlock() }()
	if hook != nil {
		if err := hook(ctx, in); err != nil {
			return FinalizeOutput{}, err
		}
	}
	var items []memory.Item
	for _, f := range in.Facts {
		items = append(items, memory.Item{Fact: f.Fact.Fact, Reason: "Stated in " + in.Path})
	}
	_, err := a.svc.Store(ctx, memory.StoreRequest{Items: items, Author: memory.AuthorAgent, Source: memory.SourceImport, SourceRef: in.FileID})
	return FinalizeOutput{CostUSD: 0.02}, err
}

type harness struct {
	t     *testing.T
	ms    *memory.Store
	agent *fakeAgent
	e     *Engine
	dir   string
}

var smallBudget = Budget{Target: 60, Max: 100, MinFill: 15, MinTail: 1, Context: 5}

func newHarness(t *testing.T, files int) *harness {
	t.Helper()
	h := &harness{t: t, dir: t.TempDir()}
	for f := 0; f < files; f++ {
		var b strings.Builder
		fmt.Fprintf(&b, "# Doc%d\n\n", f)
		for s := 0; s < 3; s++ {
			fmt.Fprintf(&b, "## Section %d\n\n%s\n\n", s, strings.TrimSpace(strings.Repeat("alpha ", 40)))
		}
		if err := os.WriteFile(filepath.Join(h.dir, fmt.Sprintf("doc%d.md", f)), []byte(b.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	h.ms = memory.NewStore(filepath.Join(t.TempDir(), "memory.db"))
	t.Cleanup(func() { _ = h.ms.Close() })
	svc := memory.NewService(h.ms, acceptRunner{}, memory.ServiceOptions{})
	t.Cleanup(svc.Close)
	h.agent = &fakeAgent{svc: svc}
	h.e = h.open()
	return h
}

func (h *harness) open() *Engine {
	h.t.Helper()
	e, err := Open(h.ms, Options{
		Agent: h.agent, Budget: smallBudget,
		Backoff: func() backoff.BackOff { return backoff.NewConstantBackOff(0) },
	})
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { _ = e.Close() })
	return e
}

func (h *harness) create() Job {
	h.t.Helper()
	j, err := h.e.Create([]string{h.dir})
	if err != nil {
		h.t.Fatal(err)
	}
	return h.waitState(j.ID, JobAwaiting).Job
}

func (h *harness) detail(id string) JobDetail {
	h.t.Helper()
	d, err := h.e.Job(id)
	if err != nil {
		h.t.Fatal(err)
	}
	return d
}

func (h *harness) waitState(id, want string) JobDetail {
	h.t.Helper()
	var d JobDetail
	testx.WaitUntil(h.t, 10*time.Second, func() bool {
		d = h.detail(id)
		return d.Job.State == want
	})
	return d
}

func (h *harness) mustStart(id string) {
	h.t.Helper()
	if err := h.e.Start(id); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) rows(q string, args ...any) []string {
	h.t.Helper()
	rs, err := h.e.st.db.Query(q, args...)
	if err != nil {
		h.t.Fatal(err)
	}
	defer rs.Close()
	var out []string
	for rs.Next() {
		var s string
		if err := rs.Scan(&s); err != nil {
			h.t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func fileByRel(d JobDetail, rel string) File {
	for _, f := range d.Files {
		if f.RelPath == rel {
			return f
		}
	}
	return File{}
}

func TestImportHappyPath(t *testing.T) {
	h := newHarness(t, 2)
	j := h.create()
	if j.Estimate.Chunks != 6 || j.Estimate.Files != 2 {
		t.Fatalf("estimate = %+v", j.Estimate)
	}
	h.mustStart(j.ID)
	d := h.waitState(j.ID, JobDone)
	for _, f := range d.Files {
		if f.State != FileDone || f.ChunkCount != 3 || f.Added != 3 {
			t.Errorf("file = %+v", f)
		}
	}
	if d.Job.Totals.Added != 6 || d.Job.Calls != 8 || d.Job.Progress.ChunksDone != 6 || d.Job.Progress.FilesDone != 2 {
		t.Errorf("job = %+v", d.Job)
	}
	if n := h.rows(`SELECT file_id FROM import_chunks`); len(n) != 0 {
		t.Errorf("chunk rows left behind: %v", n)
	}
	for _, in := range h.agent.finalInputs {
		var ids []string
		for _, f := range in.Facts {
			ids = append(ids, f.ID)
		}
		if strings.Join(ids, ",") != "1.1,2.1,3.1" {
			t.Errorf("finalize facts out of chunk order: %v", ids)
		}
	}
	if ev := h.rows(`SELECT source_ref FROM memory_events WHERE source = 'import' GROUP BY source_ref`); len(ev) != 2 {
		t.Errorf("events by file = %v", ev)
	}
}

func TestImportRetriesAndRetryFile(t *testing.T) {
	h := newHarness(t, 2)
	var transient atomic.Bool
	var broken atomic.Bool
	broken.Store(true)
	h.agent.extractHook = func(_ context.Context, in ExtractInput) error {
		if strings.HasSuffix(in.Path, "doc0.md") && in.Index == 0 && transient.CompareAndSwap(false, true) {
			return errors.New("Claude Code failed: blip")
		}
		if strings.HasSuffix(in.Path, "doc1.md") && in.Index == 1 && broken.Load() {
			return memory.ErrClaudeOutput
		}
		return nil
	}
	j := h.create()
	h.mustStart(j.ID)
	d := h.waitState(j.ID, JobDone)
	bad := fileByRel(d, "doc1.md")
	if fileByRel(d, "doc0.md").State != FileDone || bad.State != FileFailed || !strings.HasPrefix(bad.Reason, "Chunk 2 of 3: ") {
		t.Fatalf("files = %+v", d.Files)
	}
	if d.Job.Totals.FailedFiles != 1 {
		t.Errorf("totals = %+v", d.Job.Totals)
	}

	broken.Store(false)
	before := h.agent.extractRuns
	open := len(h.rows(`SELECT idx FROM import_chunks WHERE state != 'done'`))
	if err := h.e.RetryFile(bad.ID); err != nil {
		t.Fatal(err)
	}
	d = h.waitState(j.ID, JobDone)
	if fileByRel(d, "doc1.md").State != FileDone {
		t.Fatalf("after retry = %+v", fileByRel(d, "doc1.md"))
	}
	if got := h.agent.extractRuns - before; got != open || open > 2 {
		t.Errorf("retry reran %d chunks, want the %d not yet done", got, open)
	}
}

func TestImportFatalErrorPausesJob(t *testing.T) {
	h := newHarness(t, 2)
	var loggedOut atomic.Bool
	loggedOut.Store(true)
	h.agent.extractHook = func(context.Context, ExtractInput) error {
		if loggedOut.Load() {
			return memory.ErrClaudeAuth
		}
		return nil
	}
	j := h.create()
	h.mustStart(j.ID)
	d := h.waitState(j.ID, JobPaused)
	if d.Job.Reason != memory.ErrClaudeAuth.Error() {
		t.Errorf("reason = %q", d.Job.Reason)
	}
	time.Sleep(100 * time.Millisecond)
	if h.agent.extractRuns > 3 {
		t.Errorf("%d extract calls after a fatal error; only in-flight ones may run", h.agent.extractRuns)
	}
	loggedOut.Store(false)
	if err := h.e.Resume(j.ID); err != nil {
		t.Fatal(err)
	}
	if d := h.waitState(j.ID, JobDone); d.Job.Totals.FailedFiles != 0 || d.Job.Totals.Added != 6 {
		t.Errorf("job = %+v", d.Job)
	}
}

func TestImportPauseReleasesInFlightChunk(t *testing.T) {
	h := newHarness(t, 1)
	started := make(chan struct{}, 8)
	var block atomic.Bool
	block.Store(true)
	h.agent.extractHook = func(ctx context.Context, _ ExtractInput) error {
		if !block.Load() {
			return nil
		}
		started <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	}
	j := h.create()
	h.mustStart(j.ID)
	<-started
	if err := h.e.Pause(j.ID); err != nil {
		t.Fatal(err)
	}
	testx.WaitUntil(t, 5*time.Second, func() bool {
		return len(h.rows(`SELECT idx FROM import_chunks WHERE state = 'pending' AND attempts = 0`)) == 3
	})
	if d := h.detail(j.ID); d.Job.State != JobPaused || d.Job.Reason != "Paused" {
		t.Errorf("job = %+v", d.Job)
	}
	block.Store(false)
	if err := h.e.Resume(j.ID); err != nil {
		t.Fatal(err)
	}
	h.waitState(j.ID, JobDone)
}

func TestImportResumesAfterRestart(t *testing.T) {
	h := newHarness(t, 2)
	gate := make(chan struct{})
	h.agent.extractHook = func(ctx context.Context, in ExtractInput) error {
		if in.Index == 2 {
			select {
			case <-gate:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	j := h.create()
	h.mustStart(j.ID)
	testx.WaitUntil(t, 5*time.Second, func() bool {
		h.agent.mu.Lock()
		defer h.agent.mu.Unlock()
		return len(h.agent.extracted) == 4
	})
	if err := h.e.Close(); err != nil {
		t.Fatal(err)
	}
	// Leave the rows as a hard kill would: job running, a chunk running, a file finalizing.
	for _, q := range []string{
		`UPDATE import_jobs SET state = 'running'`,
		`UPDATE import_chunks SET state = 'running' WHERE state = 'pending'`,
	} {
		if _, err := h.e.st.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	h.e = h.open()
	d := h.detail(j.ID)
	if d.Job.State != JobPaused || d.Job.Reason != interruptedReason {
		t.Fatalf("job after reopen = %+v", d.Job)
	}
	if n := h.rows(`SELECT idx FROM import_chunks WHERE state = 'running'`); len(n) != 0 {
		t.Errorf("running chunks survived recovery: %v", n)
	}
	close(gate)
	if err := h.e.Resume(j.ID); err != nil {
		t.Fatal(err)
	}
	d = h.waitState(j.ID, JobDone)
	if d.Job.Totals.Added != 6 {
		t.Errorf("job = %+v", d.Job)
	}
	for key, n := range h.agent.extracted {
		if n != 1 {
			t.Errorf("%s extracted %d times", key, n)
		}
	}
}

func TestImportSkipsUnchangedAndCancels(t *testing.T) {
	h := newHarness(t, 2)
	j := h.create()
	h.mustStart(j.ID)
	h.waitState(j.ID, JobDone)
	runs := h.agent.extractRuns

	again := h.create()
	d := h.detail(again.ID)
	for _, f := range d.Files {
		if f.State != FileSkipped || !strings.HasPrefix(f.Reason, "unchanged since import on ") {
			t.Errorf("file = %+v", f)
		}
	}
	h.mustStart(again.ID)
	h.waitState(again.ID, JobDone)
	if h.agent.extractRuns != runs {
		t.Errorf("unchanged files cost %d extract calls", h.agent.extractRuns-runs)
	}

	// Cancel: a changed file is new work; block it, then cancel the job.
	if err := os.WriteFile(filepath.Join(h.dir, "doc0.md"), []byte("# Changed\n\n"+strings.Repeat("beta ", 40)), 0o644); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{}, 1)
	h.agent.extractHook = func(ctx context.Context, _ ExtractInput) error {
		select {
		case started <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return ctx.Err()
	}
	third := h.create()
	h.mustStart(third.ID)
	<-started
	if err := h.e.Cancel(third.ID); err != nil {
		t.Fatal(err)
	}
	d = h.detail(third.ID)
	if d.Job.State != JobCancelled || fileByRel(d, "doc0.md").State != FileCancelled {
		t.Errorf("after cancel = %+v / %+v", d.Job, fileByRel(d, "doc0.md"))
	}
	time.Sleep(50 * time.Millisecond)
	if n := h.rows(`SELECT file_id FROM import_chunks`); len(n) != 0 {
		t.Errorf("chunks left after cancel: %v", n)
	}
}

func TestImportConcurrencyLimits(t *testing.T) {
	h := newHarness(t, 4)
	h.agent.extractHook = func(context.Context, ExtractInput) error { time.Sleep(15 * time.Millisecond); return nil }
	h.agent.finalHook = func(context.Context, FinalizeInput) error { time.Sleep(15 * time.Millisecond); return nil }
	j := h.create()
	h.mustStart(j.ID)
	h.waitState(j.ID, JobDone)
	if h.agent.maxExtract < 2 || h.agent.maxExtract > 3 {
		t.Errorf("max concurrent extract = %d, want 2 to 3", h.agent.maxExtract)
	}
	if h.agent.maxFinal != 1 {
		t.Errorf("max concurrent finalize = %d, want 1", h.agent.maxFinal)
	}
}
