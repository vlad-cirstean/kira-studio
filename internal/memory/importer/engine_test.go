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
	factsHook   func(in ExtractInput) []Fact
	verifyHook  func(ctx context.Context, in VerifyInput) (VerifyOutput, error)
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
	facts := []Fact{{Fact: fmt.Sprintf("%s says part %d", in.Title, in.Index), Evidence: firstWord(in.Text), Section: in.HeadingPath}}
	if a.factsHook != nil {
		facts = a.factsHook(in)
	}
	return ExtractOutput{Facts: facts, CostUSD: 0.01}, nil
}

func firstWord(s string) string {
	f := strings.Fields(s)
	if len(f) == 0 {
		return "x"
	}
	return f[0]
}

func (a *fakeAgent) Verify(ctx context.Context, in VerifyInput) (VerifyOutput, error) {
	a.mu.Lock()
	hook := a.verifyHook
	a.mu.Unlock()
	if hook != nil {
		return hook(ctx, in)
	}
	out := VerifyOutput{Verdicts: map[string]Verdict{}, CostUSD: 0.01}
	for _, f := range in.Facts {
		out.Verdicts[f.ID] = Verdict{Verdict: VerdictConfirmed, Evidence: f.Evidence, Why: "found"}
	}
	return out, nil
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
	ip, err := a.svc.ImportProvenance(ctx, in.FileID)
	if err != nil {
		return FinalizeOutput{}, err
	}
	var items []memory.Item
	for _, f := range in.Facts {
		items = append(items, memory.Item{Fact: f.Fact.Fact, Reason: "Stated in " + in.Path,
			Origin: ip.Origin, SourceTag: ip.SourceTag, Scope: ip.Scope, Project: ip.Project})
	}
	_, err = a.svc.Store(ctx, memory.StoreRequest{Items: items, Source: memory.SourceImport, SourceRef: in.FileID, Session: ip.Session,
		Groups: append([]memory.GroupRef{{Kind: memory.GroupDocument, Key: ip.Path, Title: ip.RelPath}}, ip.Groups...), NoChallenge: ip.Origin == memory.OriginExternal})
	return FinalizeOutput{CostUSD: 0.02}, err
}

type harness struct {
	t     *testing.T
	ms    *memory.Store
	agent *fakeAgent
	svc   *memory.Service
	e     *Engine
	dir   string

	launcher *inProcessLauncher
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
	h.svc = svc
	h.agent = &fakeAgent{svc: svc}
	h.e = h.open()
	return h
}

func (h *harness) runnerOpts() RunnerOptions {
	return RunnerOptions{
		Agent: h.agent, Docs: h.svc, Budget: smallBudget, Tick: 20 * time.Millisecond,
		Backoff: func() backoff.BackOff { return backoff.NewConstantBackOff(0) },
	}
}

func (h *harness) open() *Engine {
	h.t.Helper()
	h.launcher = newInProcessLauncher(h.t, h.ms, h.runnerOpts())
	e, err := Open(h.ms, Options{Launcher: h.launcher})
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { _ = e.Close() })
	return e
}

func (h *harness) create() Job {
	h.t.Helper()
	j, err := h.e.Create(CreateArgs{Paths: []string{h.dir}})
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
	if err := h.e.Start(id, StartArgs{}); err != nil {
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
	d := h.waitState(j.ID, JobPaused)
	if d.Job.Reason != interruptedReason {
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

func TestImportCrossChecksQuestionableFacts(t *testing.T) {
	h := newHarness(t, 1)
	h.agent.factsHook = func(in ExtractInput) []Fact {
		if in.Index != 0 {
			return nil
		}
		return []Fact{
			{Fact: "It uses port 80.", Evidence: firstWord(in.Text), Section: "s", Unresolved: "which service"},
			{Fact: "Invented claim.", Evidence: "a quote that is nowhere", Section: "s"},
			{Fact: "Solid claim.", Evidence: firstWord(in.Text), Section: "s"},
		}
	}
	h.agent.verifyHook = func(_ context.Context, in VerifyInput) (VerifyOutput, error) {
		if len(in.Facts) != 2 || len(in.Source) == 0 {
			return VerifyOutput{}, fmt.Errorf("verify input = %+v", in.Facts)
		}
		return VerifyOutput{Verdicts: map[string]Verdict{
			"1.1": {Verdict: VerdictRewritten, Fact: "The web service uses port 80.", Evidence: "alpha", Why: "named"},
			"1.2": {Verdict: VerdictUnsupported, Why: "no such text"},
		}}, nil
	}
	j := h.create()
	h.mustStart(j.ID)
	f := fileByRel(h.waitState(j.ID, JobDone), "doc0.md")
	if f.Verified != 2 || len(f.Dropped) != 1 || !strings.HasPrefix(f.Dropped[0].Why, "Not supported by the source: ") {
		t.Fatalf("file = %+v", f)
	}
	var got []string
	for _, in := range h.agent.finalInputs {
		for _, ff := range in.Facts {
			if ff.Chunk == 1 {
				got = append(got, ff.Fact.Fact+"|"+ff.Unresolved)
			}
		}
	}
	if strings.Join(got, ";") != "The web service uses port 80.|;Solid claim.|" {
		t.Errorf("finalize chunk 1 facts = %q", got)
	}
}

// A kira-memory doc header wins on apply, so an unattended MCP job must not start on a header that
// claims more than the job holds.
func TestAutoStartWaitsOnMemdocHeaderClaims(t *testing.T) {
	doc := func(origin, scope, project string) string {
		if project != "" {
			project = "project: " + project + "\n"
		}
		return "---\nkira-memory: 1\ngroup: kg_4m9xq2c7v8ab\ntitle: Billing deploys\norigin: " + origin + "\nscope: " + scope + "\n" + project + "updated: 2026-10-12\n---\n\n## Ports\n\n" +
			"km_7h3kq9x2mfa4 fact: Billing API listens on port 9090 in production.\nkm_7h3kq9x2mfa4 reason: Deploy manifest changed in March release.\n"
	}
	cases := []struct {
		name, origin, scope, project string
		wait                         bool
	}{
		{"origin above job", "user", "project", "github.com/acme/billing", true},
		{"company scope above job", "agent", "company", "", true},
		{"other project", "agent", "project", "github.com/acme/payments", true},
		{"personal scope", "agent", "personal", "", true},
		{"within job trust", "agent", "project", "github.com/acme/billing", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := newHarness(t, 0)
			if err := os.WriteFile(filepath.Join(h.dir, "mem.md"), []byte(doc(c.origin, c.scope, c.project)), 0o644); err != nil {
				t.Fatal(err)
			}
			j, err := h.e.Create(CreateArgs{Paths: []string{h.dir}, Channel: ChannelMCP, AutoStart: true,
				Provenance: Provenance{Origin: memory.OriginAgent, Scope: memory.ScopeProject, Project: "github.com/acme/billing"}})
			if err != nil {
				t.Fatal(err)
			}
			if !c.wait {
				h.waitState(j.ID, JobDone)
				return
			}
			d := h.waitState(j.ID, JobAwaiting)
			if !strings.Contains(d.Job.Reason, "Needs confirmation in Kira Space: 1 kira-memory docs claim") {
				t.Errorf("reason = %q", d.Job.Reason)
			}
			h.mustStart(j.ID)
			h.waitState(j.ID, JobDone)
		})
	}
}

// Finalize/verify claims must not rescan extracted files per tick: once verify_pending is settled,
// an idle tick is an indexed lookup, not a reload of every chunk (P281 A1).
func TestIdleClaimsDoNotScaleWithExtractedFiles(t *testing.T) {
	const files, chunks = 300, 10
	h := newHarness(t, 1)
	j := h.create()
	text := strings.Repeat("alpha beta gamma delta ", 80)
	facts := `[{"fact":"x","evidence":"no such quote","section":"s"},{"fact":"y","evidence":"nowhere","section":"s"}]`
	tx, err := h.e.st.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE import_jobs SET state = 'running' WHERE id = ?`, j.ID); err != nil {
		t.Fatal(err)
	}
	for f := 0; f < files; f++ {
		id := fmt.Sprintf("bulk%d", f)
		if _, err := tx.Exec(`INSERT INTO import_files (id, job_id, path, rel_path, kind, size, state, chunk_count, updated_at)
			VALUES (?, ?, ?, ?, 'markdown', 1, 'extracted', ?, 'now')`, id, j.ID, id, id, chunks); err != nil {
			t.Fatal(err)
		}
		for c := 0; c < chunks; c++ {
			if _, err := tx.Exec(`INSERT INTO import_chunks (file_id, idx, text, tokens, state, facts) VALUES (?, ?, ?, 1, 'done', ?)`,
				id, c, text, facts); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	// Every file has questionable facts without verdicts, so finalize has nothing to claim.
	start := time.Now()
	if _, ok, err := h.e.st.claimFinalize(); err != nil || ok {
		t.Fatalf("first claimFinalize ok=%v err=%v", ok, err)
	}
	settle := time.Since(start)
	const ticks = 200
	start = time.Now()
	for i := 0; i < ticks; i++ {
		if _, ok, err := h.e.st.claimFinalize(); err != nil || ok {
			t.Fatalf("idle claimFinalize ok=%v err=%v", ok, err)
		}
	}
	idle := time.Since(start) / ticks
	t.Logf("files=%d chunks=%d settle(first tick)=%s idle tick=%s", files, chunks, settle, idle)
	if idle*10 > settle {
		t.Errorf("idle tick %s is not far below the one-off settle %s: claims scan files per tick", idle, settle)
	}
}
