package memoryflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// importApp boots the app with the shim and a finalize agent that stores two facts through the real
// memory-mcp server. The gate answers come from gate-<file>.json.
func importApp(t *testing.T) (*flowharness.App, string) {
	t.Helper()
	app := flowharness.New(t)
	dir := jsonClaude(t, app)
	for _, f := range []string{"gate-billing.md.json", "gate-release.md.json", "reconcile.json", "extract-billing.md.json", "extract-release.md.json"} {
		shimFile(t, dir, f, f)
	}
	finalize, err := filepath.Abs(filepath.Join("testdata", "finalize.json"))
	if err != nil {
		t.Fatal(err)
	}
	app.Scenario(fakeagent.Scenario{Claude: map[string][]fakeagent.Action{"*": {{
		MCP: []fakeagent.MCPCall{{Server: "kira-memory", Tool: "store_memory", Args: map[string]any{
			"author": "agent",
			"items": []map[string]string{
				{"fact": "first", "reason": "document"},
				{"fact": "second", "reason": "document"},
			},
		}}},
		Emit: finalize,
	}}}})
	return app, dir
}

func jobDetail(t *testing.T, app *flowharness.App, id string) importer.JobDetail {
	t.Helper()
	d, err := app.W.MemoryImport.Job(bridge.MemoryImportJobArgs{ID: id})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func waitJob(t *testing.T, app *flowharness.App, id string, states ...string) importer.JobDetail {
	t.Helper()
	var got importer.JobDetail
	testx.WaitUntil(t, waitFor, func() bool {
		got = jobDetail(t, app, id)
		for _, s := range states {
			if got.Job.State == s {
				return true
			}
		}
		return false
	})
	return got
}

// createJob picks dir through the folder dialog and returns the job once its scan ended.
func createJob(t *testing.T, app *flowharness.App, dir string) importer.JobDetail {
	t.Helper()
	app.Dialogs.AnswerDirectory(dir)
	choice, err := app.W.MemoryImport.Choose(bridge.MemoryImportChooseArgs{Kind: "folder"})
	if err != nil || choice.Canceled || len(choice.Paths) != 1 {
		t.Fatalf("Choose = %+v, %v", choice, err)
	}
	job, err := app.W.MemoryImport.Create(bridge.MemoryImportCreateArgs{Paths: choice.Paths})
	if err != nil {
		t.Fatal(err)
	}
	return waitJob(t, app, job.ID, importer.JobAwaiting)
}

func fileNamed(t *testing.T, d importer.JobDetail, rel string) importer.File {
	t.Helper()
	for _, f := range d.Files {
		if f.RelPath == rel {
			return f
		}
	}
	t.Fatalf("job has no file %s: %+v", rel, d.Files)
	return importer.File{}
}

func importDir(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("testdata", "import"))
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

func TestImportLifecycle(t *testing.T) {
	app, shim := importApp(t)

	awaiting := createJob(t, app, importDir(t))
	if awaiting.Job.Estimate.Files != 2 || len(awaiting.Files) != 2 {
		t.Fatalf("scanned job = %+v, want the two documents", awaiting)
	}
	mark := app.Events.Mark()
	if err := app.W.MemoryImport.Start(bridge.MemoryImportJobArgs{ID: awaiting.Job.ID}); err != nil {
		t.Fatal(err)
	}
	done := waitJob(t, app, awaiting.Job.ID, importer.JobDone)
	if done.Job.Totals.Added != 4 || done.Job.Totals.FailedFiles != 0 || done.Job.Progress.FilesDone != 2 {
		t.Fatalf("finished job = %+v, want four memories from two files", done.Job)
	}
	for _, rel := range []string{"billing.md", "release.md"} {
		if f := fileNamed(t, done, rel); f.State != importer.FileDone || f.Added != 2 {
			t.Fatalf("file %s = %+v, want done with two added", rel, f)
		}
	}
	app.Events.WaitAfter(t, mark, bridge.ChannelMemoryImport, nil, waitFor)

	hits, err := app.W.Memory.Search(ctx, bridge.MemorySearchArgs{Query: "invoices"})
	if err != nil || len(hits) == 0 || hits[0].Author != memory.AuthorAgent {
		t.Fatalf("Search invoices = %+v, %v, want an agent memory", hits, err)
	}
	hist, err := app.W.Memory.History(ctx, bridge.MemoryIDArgs{ID: hits[0].ID})
	if err != nil || len(hist.Events) != 1 || hist.Events[0].Source != memory.SourceImport || hist.Events[0].SourceLabel != "billing.md" {
		t.Fatalf("History = %+v, %v, want one import event labelled billing.md", hist, err)
	}
	if all, _ := app.W.Memory.Recent(ctx); len(all) != 4 {
		t.Fatalf("Recent holds %d memories, want 4", len(all))
	}
	if err := app.W.MemoryImport.Dismiss(bridge.MemoryImportJobArgs{ID: done.Job.ID}); err != nil {
		t.Fatal(err)
	}
	if jobs, err := app.W.MemoryImport.Jobs(); err != nil || len(jobs) != 0 {
		t.Fatalf("Jobs after Dismiss = %+v, %v, want none", jobs, err)
	}

	// A second job, held mid-extract: pause and resume keep it alive, cancel ends it for good.
	docs := t.TempDir()
	if err := os.WriteFile(filepath.Join(docs, "ops.md"), []byte("# Ops\n\nPager rotation changes every Monday.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	shimFile(t, shim, "extract-billing.md.json", "extract-ops.md.json")
	if err := os.WriteFile(filepath.Join(shim, "hold"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	second := createJob(t, app, docs)
	id := bridge.MemoryImportJobArgs{ID: second.Job.ID}
	if err := app.W.MemoryImport.Start(id); err != nil {
		t.Fatal(err)
	}
	waitJob(t, app, id.ID, importer.JobRunning)
	if err := app.W.MemoryImport.Pause(id); err != nil {
		t.Fatal(err)
	}
	if got := jobDetail(t, app, id.ID).Job.State; got != importer.JobPaused {
		t.Fatalf("state after Pause = %s", got)
	}
	if err := app.W.MemoryImport.Resume(id); err != nil {
		t.Fatal(err)
	}
	waitJob(t, app, id.ID, importer.JobRunning)
	if err := app.W.MemoryImport.Cancel(id); err != nil {
		t.Fatal(err)
	}
	if got := jobDetail(t, app, id.ID).Job.State; got != importer.JobCancelled {
		t.Fatalf("state after Cancel = %s", got)
	}
	if all, _ := app.W.Memory.Recent(ctx); len(all) != 4 {
		t.Fatalf("cancelled job changed the store: %d memories", len(all))
	}

	// An awaiting job can be discarded without running.
	spare := t.TempDir()
	if err := os.WriteFile(filepath.Join(spare, "spare.md"), []byte("# Spare\n\nNobody reads this.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	third := createJob(t, app, spare)
	if err := app.W.MemoryImport.Discard(bridge.MemoryImportJobArgs{ID: third.Job.ID}); err != nil {
		t.Fatal(err)
	}
	jobs, err := app.W.MemoryImport.Jobs()
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range jobs {
		if j.ID == third.Job.ID {
			t.Fatalf("discarded job %s still listed", j.ID)
		}
	}
}

// The first extract answer for release.md spends its budget, so the file fails; the retries rerun
// only what failed.
func TestImportRetries(t *testing.T) {
	flowharness.Complete(t)
	app, shim := importApp(t)
	if err := os.WriteFile(filepath.Join(shim, "fail-release.md"), []byte("2"), 0o644); err != nil {
		t.Fatal(err)
	}
	job := createJob(t, app, importDir(t))
	id := bridge.MemoryImportJobArgs{ID: job.Job.ID}
	if err := app.W.MemoryImport.Start(id); err != nil {
		t.Fatal(err)
	}
	failed := waitJob(t, app, id.ID, importer.JobDone, importer.JobFailed)
	rel := fileNamed(t, failed, "release.md")
	if rel.State != importer.FileFailed || failed.Job.Totals.FailedFiles != 1 || fileNamed(t, failed, "billing.md").State != importer.FileDone {
		t.Fatalf("job = %+v files %+v, want release.md failed and billing.md done", failed.Job, failed.Files)
	}
	if err := app.W.MemoryImport.RetryFile(bridge.MemoryImportFileArgs{FileID: rel.ID}); err != nil {
		t.Fatal(err)
	}
	var again importer.JobDetail
	testx.WaitUntil(t, waitFor, func() bool {
		left, _ := os.ReadFile(filepath.Join(shim, "fail-release.md"))
		again = jobDetail(t, app, id.ID)
		return strings.TrimSpace(string(left)) == "0" && again.Job.State != importer.JobRunning &&
			fileNamed(t, again, "release.md").State == importer.FileFailed
	})
	if got := fileNamed(t, again, "release.md"); got.State != importer.FileFailed {
		t.Fatalf("release.md after the first retry = %+v, want it failed again (the second budget error)", got)
	}
	if err := app.W.MemoryImport.RetryFailed(id); err != nil {
		t.Fatal(err)
	}
	final := waitJob(t, app, id.ID, importer.JobDone)
	if f := fileNamed(t, final, "release.md"); f.State != importer.FileDone || f.Added != 2 || final.Job.Totals.Added != 4 || final.Job.Totals.FailedFiles != 0 {
		t.Fatalf("job after RetryFailed = %+v files %+v, want everything done", final.Job, final.Files)
	}
	if hits, err := app.W.Memory.Search(ctx, bridge.MemorySearchArgs{Query: "staging"}); err != nil || len(hits) != 1 {
		t.Fatalf("Search staging = %+v, %v", hits, err)
	}
}
