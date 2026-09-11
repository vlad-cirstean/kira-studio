package gitsock

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// isDiffSpawn recognizes the two argv shapes G11's tiers 1/2 use to produce an actual patch
// (FileDiffArgs' `diff-tree -p` and NoIndexDiffArgs' `diff --no-index`) — tier 0 (blob-oid
// equality) must spawn neither.
func isDiffSpawn(args []string) bool {
	if len(args) == 0 {
		return false
	}
	hasFlag := func(flag string) bool {
		for _, a := range args {
			if a == flag {
				return true
			}
		}
		return false
	}
	switch args[0] {
	case "diff-tree":
		return hasFlag("-p")
	case "diff":
		return hasFlag("--no-index")
	default:
		return false
	}
}

// §3.6's own end-to-end proof: G11's three new methods over a real socket against real fixture
// repositories — the three-dot range's file list, the three-tier delta selection (unchanged/fast/
// slow, including a genuinely pruned snapshot commit), partial-range projection surviving an
// insertion, the full->partial demotion, a binary file's honest degradation, two connections
// sharing review state, the E_BAD_REQUEST refusals, and — the single most load-bearing test in
// this phase — refsChanged NOT dropping review state (D14).

func incSkipWithoutGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func incWriteFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func incCommit(t *testing.T, dir, msg string) string {
	t.Helper()
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg)
	return trimNewline(runGitInOutput(t, dir, "rev-parse", "HEAD"))
}

// runGitInOutput mirrors runGitIn but returns stdout — runGitIn itself (integration_test.go) only
// asserts success.
func runGitInOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// buildMainFeatureFixture builds main (one commit, a.txt) and feature branched off it with one
// extra commit — the topology every scenario below starts from before its own mutation.
func buildMainFeatureFixture(t *testing.T) (dir, mainSha, featureSha string) {
	t.Helper()
	incSkipWithoutGit(t)
	dir = t.TempDir()
	runGitIn(t, dir, "init", "-q", "-b", "main")
	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\n")
	runGitIn(t, dir, "add", "a.txt")
	mainSha = incCommit(t, dir, "base commit")

	runGitIn(t, dir, "checkout", "-q", "-b", "feature")
	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\n")
	runGitIn(t, dir, "add", "a.txt")
	featureSha = incCommit(t, dir, "feature commit")
	return dir, mainSha, featureSha
}

func markFile(t *testing.T, c *testClient, repoID, branch, path string, reviewed bool, ranges []gitreview.LineRange) gitsession.ReviewFileStatus {
	t.Helper()
	resp := requestOK(t, c, "review.mark", gitrpc.ReviewMarkParams{
		RepoID: repoID, Branch: branch, Path: path, Reviewed: reviewed, Ranges: ranges,
	})
	return unmarshalResult[gitrpc.ReviewMarkResult](t, resp.Result).Review
}

func reviewFiles(t *testing.T, c *testClient, repoID, branch, base string) gitsession.RangeFilesResult {
	t.Helper()
	resp := requestOK(t, c, "review.files", gitrpc.ReviewFilesParams{RepoID: repoID, Branch: branch, Base: base})
	return unmarshalResult[gitsession.RangeFilesResult](t, resp.Result)
}

func reviewFileDiff(t *testing.T, c *testClient, repoID, branch, base, path, mode string) gitsession.ReviewFileDiffResult {
	t.Helper()
	resp := requestOK(t, c, "review.fileDiff", gitrpc.ReviewFileDiffParams{
		RepoID: repoID, Branch: branch, Base: base, Path: path, Mode: mode,
	})
	return unmarshalResult[gitsession.ReviewFileDiffResult](t, resp.Result)
}

// waitForRefsChanged blocks until the watcher's own refsChanged signal reaches this connection —
// required after every git mutation made OUTSIDE the socket (a direct `git` call in the test),
// since RepoEntry.Refs is cached and branchTip/mergeBase read that cache: without this, the very
// next request can race the fsnotify watcher and observe the OLD tip. A commit is usually preceded
// by `git add` (an index write the watcher reports as a SEPARATE worktreeChanged event,
// subscriber.go's own "refs first, then worktree" ordering when both fire on the same wake) — that
// straggler is drained here too, so it can never be mistaken for the next request's own response.
func waitForRefsChanged(t *testing.T, c *testClient) {
	t.Helper()
	ev := c.recvEvent("repo.changed")
	if ev.Kind != "refsChanged" {
		t.Fatalf("event = %+v, want refsChanged", ev)
	}
	drainStragglerEvents(t, c)
}

// drainStragglerEvents best-effort reads any immediately-following event frames using a short
// read deadline — a timeout (nothing more queued) ends the drain silently; any actual "res"/
// "chunk" frame arriving here would mean this helper was called at the wrong point and is a real
// test bug, so that case still fails loudly.
func drainStragglerEvents(t *testing.T, c *testClient) {
	t.Helper()
	for {
		_ = c.nc.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
		raw, err := readFrame(c.r)
		if err != nil {
			break
		}
		var env wireEnvelope
		if jsonErr := json.Unmarshal(raw, &env); jsonErr != nil || env.Body.T != "evt" {
			t.Fatalf("drainStragglerEvents: unexpected non-event frame: %s", raw)
		}
	}
	_ = c.nc.SetReadDeadline(time.Time{})
}

func findEntry(files []gitsession.ReviewFileEntry, path string) (gitsession.ReviewFileEntry, bool) {
	for _, f := range files {
		if f.Change.Path == path {
			return f, true
		}
	}
	return gitsession.ReviewFileEntry{}, false
}

// TestIntegration_ReviewFilesIsTheThreeDotRange is F3/probe P7's own end-to-end proof: the
// returned paths equal a real three-dot diff, and a file deleted on the BASE after divergence
// (not by the branch) is absent — asserted against git itself.
func TestIntegration_ReviewFilesIsTheThreeDotRange(t *testing.T) {
	t.Parallel()
	incSkipWithoutGit(t)
	dir := t.TempDir()
	runGitIn(t, dir, "init", "-q", "-b", "main")
	incWriteFile(t, dir, "keep.txt", "keep\n")
	incWriteFile(t, dir, "k.txt", "will be deleted on main\n")
	runGitIn(t, dir, "add", "keep.txt", "k.txt")
	incCommit(t, dir, "base commit")

	runGitIn(t, dir, "checkout", "-q", "-b", "feature")
	incWriteFile(t, dir, "n.txt", "new on feature\n")
	runGitIn(t, dir, "add", "n.txt")
	incCommit(t, dir, "feature commit")

	runGitIn(t, dir, "checkout", "-q", "main")
	runGitIn(t, dir, "rm", "-q", "k.txt")
	incCommit(t, dir, "delete k.txt on main")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "range-files-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	result := reviewFiles(t, client, repoID, "feature", "main")

	// The real three-dot answer, from git itself.
	mergeBase := trimNewline(runGitInOutput(t, dir, "merge-base", "main", "feature"))
	want := trimNewline(runGitInOutput(t, dir, "diff", "--name-only", mergeBase, "feature"))
	wantPaths := map[string]bool{}
	for _, p := range splitLinesNonEmpty(want) {
		wantPaths[p] = true
	}
	if _, ok := wantPaths["k.txt"]; ok {
		t.Fatal("test setup error: k.txt should not appear in the three-dot diff")
	}
	gotPaths := map[string]bool{}
	for _, f := range result.Files {
		gotPaths[f.Change.Path] = true
	}
	if len(gotPaths) != len(wantPaths) {
		t.Fatalf("review.files paths = %v, want %v", gotPaths, wantPaths)
	}
	for p := range wantPaths {
		if !gotPaths[p] {
			t.Fatalf("review.files is missing %q, want it present (real three-dot diff): got %v", p, gotPaths)
		}
	}
	if gotPaths["k.txt"] {
		t.Fatal("review.files includes k.txt, which was deleted on main AFTER divergence, not by feature")
	}
}

func splitLinesNonEmpty(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == '\n' {
			if i > start {
				out = append(out, s[start:i])
			}
			start = i + 1
		}
	}
	return out
}

// TestIntegration_MarkThenNothingChangesTakesTheUnchangedPath proves D7 tier 0 end to end: after
// marking a.txt reviewed and landing an unrelated commit, review.fileDiff reports "unchanged" with
// no git diff spawn at all.
func TestIntegration_MarkThenNothingChangesTakesTheUnchangedPath(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)

	realRunner := gitclient.NewExecRunner()
	var diffSpawns int32
	countRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if isDiffSpawn(spec.Args) {
			atomic.AddInt32(&diffSpawns, 1)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})
	server, sockPath, _, _ := newIntegrationServerWithRunner(t, countRunner)
	client := pairAndReady(t, server, sockPath, "unchanged-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	markFile(t, client, repoID, "feature", "a.txt", true, nil)

	incWriteFile(t, dir, "b.txt", "unrelated\n")
	runGitIn(t, dir, "add", "b.txt")
	incCommit(t, dir, "unrelated commit")

	before := atomic.LoadInt32(&diffSpawns)
	result := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	after := atomic.LoadInt32(&diffSpawns)

	if result.DeltaSource != "unchanged" {
		t.Fatalf("DeltaSource = %q, want unchanged", result.DeltaSource)
	}
	if result.Body.Kind != "empty" {
		t.Fatalf("Body.Kind = %q, want empty", result.Body.Kind)
	}
	if after != before {
		t.Fatalf("diff spawns = %d, want %d (tier 0 needs no diff at all)", after, before)
	}

	// The list path agrees too.
	files := reviewFiles(t, client, repoID, "feature", "main")
	entry, ok := findEntry(files.Files, "a.txt")
	if !ok {
		t.Fatal("a.txt missing from review.files")
	}
	if entry.Review.Kind != "full" || entry.Review.ChangedSinceReview {
		t.Fatalf("a.txt status = %+v, want full/unchanged", entry.Review)
	}
}

// TestIntegration_MarkThenEditTakesTheFastPath is D7 tier 1's own proof: an ordinary commit
// editing the reviewed file takes the fast path, and the badge/status agree.
func TestIntegration_MarkThenEditTakesTheFastPath(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "fast-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	markFile(t, client, repoID, "feature", "a.txt", true, nil)

	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\nline5\n")
	runGitIn(t, dir, "add", "a.txt")
	incCommit(t, dir, "edit a.txt")
	waitForRefsChanged(t, client)

	result := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	if result.DeltaSource != "fast" {
		t.Fatalf("DeltaSource = %q, want fast", result.DeltaSource)
	}
	if result.Body.Kind != "text" || len(result.Body.Hunks) == 0 {
		t.Fatalf("Body = %+v, want a real text diff", result.Body)
	}

	files := reviewFiles(t, client, repoID, "feature", "main")
	entry, ok := findEntry(files.Files, "a.txt")
	if !ok || !entry.Review.ChangedSinceReview {
		t.Fatalf("a.txt status = %+v, want changedSinceReview", entry.Review)
	}
}

// TestIntegration_MarkThenAmendTakesTheSlowPath is F4/probe P2's own headline scenario, over the
// real socket: the reviewed commit is amended away (unreachable but present), and the delta is
// still exact via the stored blob.
func TestIntegration_MarkThenAmendTakesTheSlowPath(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "slow-amend-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	markFile(t, client, repoID, "feature", "a.txt", true, nil)

	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\nline5\n")
	runGitIn(t, dir, "add", "a.txt")
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "--amend", "-q", "-m", "amended")
	waitForRefsChanged(t, client)

	result := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	if result.DeltaSource != "slow" {
		t.Fatalf("DeltaSource = %q, want slow", result.DeltaSource)
	}
	if result.Body.Kind != "text" || len(result.Body.Hunks) == 0 {
		t.Fatalf("Body = %+v, want a real text diff", result.Body)
	}
}

// TestIntegration_MarkThenPruneStillTakesTheSlowPath is D18's own "genuinely pruned" scenario:
// after the amended-away commit is actually garbage collected (exit 128, not 1), the slow path is
// still correct.
func TestIntegration_MarkThenPruneStillTakesTheSlowPath(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "slow-prune-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	markFile(t, client, repoID, "feature", "a.txt", true, nil)

	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\nline5\n")
	runGitIn(t, dir, "add", "a.txt")
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "--amend", "-q", "-m", "amended")
	waitForRefsChanged(t, client)
	runGitIn(t, dir, "reflog", "expire", "--expire=now", "--all")
	runGitIn(t, dir, "gc", "--prune=now", "-q")

	result := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	if result.DeltaSource != "slow" {
		t.Fatalf("DeltaSource = %q, want slow", result.DeltaSource)
	}
	if result.Body.Kind != "text" || len(result.Body.Hunks) == 0 {
		t.Fatalf("Body = %+v, want a real text diff", result.Body)
	}
}

// TestIntegration_PartialRangesSurviveAnInsertion is D10's own whole claim, over the socket: a
// partial mark's ranges shift correctly when unrelated lines are inserted above them.
func TestIntegration_PartialRangesSurviveAnInsertion(t *testing.T) {
	t.Parallel()
	incSkipWithoutGit(t)
	dir := t.TempDir()
	runGitIn(t, dir, "init", "-q", "-b", "main")
	lines := ""
	for i := 1; i <= 30; i++ {
		lines += "line" + itoa(i) + "\n"
	}
	incWriteFile(t, dir, "a.txt", lines)
	runGitIn(t, dir, "add", "a.txt")
	incCommit(t, dir, "base commit")
	runGitIn(t, dir, "checkout", "-q", "-b", "feature")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "partial-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	markFile(t, client, repoID, "feature", "a.txt", true, []gitreview.LineRange{{Start: 10, End: 20}})

	// Insert 5 lines above the reviewed range, then commit.
	newLines := ""
	for i := 1; i <= 5; i++ {
		newLines += "inserted" + itoa(i) + "\n"
	}
	rest := lines // lines 1..30, unindented copy
	incWriteFile(t, dir, "a.txt", newLines+rest)
	runGitIn(t, dir, "add", "a.txt")
	incCommit(t, dir, "insert 5 lines above")
	waitForRefsChanged(t, client)

	result := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	want := []gitreview.LineRange{{Start: 15, End: 25}}
	if len(result.ReviewedRanges) != 1 || result.ReviewedRanges[0] != want[0] {
		t.Fatalf("ReviewedRanges = %v, want %v", result.ReviewedRanges, want)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// TestIntegration_UnmarkingPartOfAFullFileDemotesIt is D10's full->partial demotion, over the
// socket: a fully-reviewed file, unmarking a sub-range, leaves the complement reviewed.
func TestIntegration_UnmarkingPartOfAFullFileDemotesIt(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "demote-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	status := markFile(t, client, repoID, "feature", "a.txt", true, nil)
	if status.Kind != "full" {
		t.Fatalf("initial mark status = %+v, want full", status)
	}

	status = markFile(t, client, repoID, "feature", "a.txt", false, []gitreview.LineRange{{Start: 2, End: 2}})
	if status.Kind != "partial" {
		t.Fatalf("status after unmarking line 2 = %+v, want partial", status)
	}

	result := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	want := []gitreview.LineRange{{Start: 1, End: 1}, {Start: 3, End: 4}}
	if len(result.ReviewedRanges) != len(want) {
		t.Fatalf("ReviewedRanges = %v, want %v", result.ReviewedRanges, want)
	}
	for i, r := range want {
		if result.ReviewedRanges[i] != r {
			t.Fatalf("ReviewedRanges = %v, want %v", result.ReviewedRanges, want)
		}
	}
}

// TestIntegration_BinarySnapshotDegradesHonestly is D9's own binary arm, over the socket: a binary
// file marked reviewed, then rewritten, reports snapshotUnavailable — never "unchanged", never an
// error — and a ranged mark on it is refused.
func TestIntegration_BinarySnapshotDegradesHonestly(t *testing.T) {
	t.Parallel()
	incSkipWithoutGit(t)
	dir := t.TempDir()
	runGitIn(t, dir, "init", "-q", "-b", "main")
	incWriteFile(t, dir, "placeholder.txt", "placeholder\n")
	runGitIn(t, dir, "add", "placeholder.txt")
	incCommit(t, dir, "base commit")

	// feature's own commit (never main's) — amending it below must keep main as an ancestor of
	// the amended tip, rather than orphaning a root commit into a second, unrelated history.
	runGitIn(t, dir, "checkout", "-q", "-b", "feature")
	if err := os.WriteFile(filepath.Join(dir, "img.bin"), []byte{0x89, 'P', 'N', 'G', 0x00, 0x01}, 0o644); err != nil {
		t.Fatalf("write img.bin: %v", err)
	}
	runGitIn(t, dir, "add", "img.bin")
	incCommit(t, dir, "add binary")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "binary-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	// G30 round-1 functional-correctness review, finding #1: marking a whole file reviewed used to
	// materialize "the whole file" as Expand(currentLineCount), which is nil for any file that
	// snapshots at lineCount 0 — binary included — so the mark silently landed as
	// state="partial", ranges=nil, which review.files/review.mark's own response both read back as
	// kind "none": the checkbox flipped back off with no error. Asserting Kind here is this test's
	// own missing assertion the review called out — it previously marked the file and moved on
	// without ever checking what state that mark actually produced.
	status := markFile(t, client, repoID, "feature", "img.bin", true, nil)
	if status.Kind != "full" {
		t.Fatalf("review.mark on a binary file: Kind = %q, want full", status.Kind)
	}
	filesAfterMark := reviewFiles(t, client, repoID, "feature", "main")
	if entry, ok := findEntry(filesAfterMark.Files, "img.bin"); !ok || entry.Review.Kind != "full" {
		t.Fatalf("review.files after marking a binary file reviewed: entry = %+v, want kind full", entry)
	}

	// Keeps the NUL byte (looksBinary's own sniff) so the rewrite is still classified as binary —
	// only the trailing byte actually changes.
	if err := os.WriteFile(filepath.Join(dir, "img.bin"), []byte{0x89, 'P', 'N', 'G', 0x00, 0xFE}, 0o644); err != nil {
		t.Fatalf("rewrite img.bin: %v", err)
	}
	runGitIn(t, dir, "add", "img.bin")
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "--amend", "-q", "-m", "amended binary")
	waitForRefsChanged(t, client)

	result := reviewFileDiff(t, client, repoID, "feature", "main", "img.bin", "sinceReview")
	if result.DeltaSource != "snapshotUnavailable" {
		t.Fatalf("DeltaSource = %q, want snapshotUnavailable", result.DeltaSource)
	}
	if len(result.ReviewedRanges) != 0 {
		t.Fatalf("ReviewedRanges = %v, want empty", result.ReviewedRanges)
	}

	resp := client.request("review.mark", gitrpc.ReviewMarkParams{
		RepoID: repoID, Branch: "feature", Path: "img.bin", Reviewed: true,
		Ranges: []gitreview.LineRange{{Start: 1, End: 1}},
	})
	assertBadRequest(t, resp, "text")
}

// TestIntegration_DeletedFileCanBeMarkedReviewed is G30 round-1 functional-correctness review,
// finding #1's other real-world arm: a branch that deletes a file entirely (common in any review)
// snapshots that path at lineCount 0 the same way a binary file does — the same "given absent =>
// whole file" bug applied here too, silently refusing every mark on a deleted file.
func TestIntegration_DeletedFileCanBeMarkedReviewed(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	runGitIn(t, dir, "checkout", "-q", "feature")
	runGitIn(t, dir, "rm", "-q", "a.txt")
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "delete a.txt")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "deleted-file-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	status := markFile(t, client, repoID, "feature", "a.txt", true, nil)
	if status.Kind != "full" {
		t.Fatalf("review.mark on a deleted file: Kind = %q, want full", status.Kind)
	}

	files := reviewFiles(t, client, repoID, "feature", "main")
	entry, ok := findEntry(files.Files, "a.txt")
	if !ok || entry.Review.Kind != "full" {
		t.Fatalf("review.files after marking a deleted file reviewed: entry = %+v, want kind full", entry)
	}

	// Unmarking must clear it back to "none" — the same Expand(0)-was-nil bug would have made
	// this a no-op too (Subtract(existing, nil) leaves existing untouched).
	status = markFile(t, client, repoID, "feature", "a.txt", false, nil)
	if status.Kind != "none" {
		t.Fatalf("review.mark(reviewed=false) on a deleted file: Kind = %q, want none", status.Kind)
	}
}

// TestIntegration_TwoConnectionsShareReviewState is D12's own shared-state claim: a mark on
// connection A is visible in connection B's next review.files.
func TestIntegration_TwoConnectionsShareReviewState(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA := pairAndReady(t, server, sockPath, "shared-a")
	clientB := pairAndReady(t, server, sockPath, "shared-b")
	repoIDA := openRepoOK(t, clientA, dir).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, dir).Repo.RepoID
	if repoIDA != repoIDB {
		t.Fatalf("repoID differs between connections: %q vs %q", repoIDA, repoIDB)
	}

	markFile(t, clientA, repoIDA, "feature", "a.txt", true, nil)

	filesB := reviewFiles(t, clientB, repoIDB, "feature", "main")
	entry, ok := findEntry(filesB.Files, "a.txt")
	if !ok || entry.Review.Kind != "full" {
		t.Fatalf("connection B's review.files = %+v, want a.txt full (shared with connection A's mark)", filesB.Files)
	}
}

// TestIntegration_ReviewRefusalsAreBadRequests is D13's own validation rules: an empty path, a
// branch beginning with "-", and a branch not in the ref snapshot are all E_BAD_REQUEST naming the
// field, never a spawn.
func TestIntegration_ReviewRefusalsAreBadRequests(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "refusals-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	resp := client.request("review.fileDiff", gitrpc.ReviewFileDiffParams{
		RepoID: repoID, Branch: "feature", Base: "main", Path: "", Mode: "sinceReview",
	})
	assertBadRequest(t, resp, "path")

	resp = client.request("review.files", gitrpc.ReviewFilesParams{RepoID: repoID, Branch: "-evil", Base: "main"})
	assertBadRequest(t, resp, "branch")

	resp = client.request("review.files", gitrpc.ReviewFilesParams{RepoID: repoID, Branch: "no-such-branch", Base: "main"})
	assertBadRequest(t, resp, "branch")
}

// TestIntegration_RefsChangedDoesNotDropReviewState is D14's own negative claim, and the one a
// future contributor is most likely to break: force-moving an UNRELATED branch fires refsChanged,
// and every mark is still there afterward.
func TestIntegration_RefsChangedDoesNotDropReviewState(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildMainFeatureFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "refschanged-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	status := markFile(t, client, repoID, "feature", "a.txt", true, nil)
	if status.Kind != "full" {
		t.Fatalf("mark status = %+v, want full", status)
	}

	// An unrelated ref move — nothing to do with the reviewed branch or file at all.
	runGitIn(t, dir, "branch", "unrelated-branch")
	ev := client.recvEvent("repo.changed")
	if ev.Kind != "refsChanged" {
		t.Fatalf("event = %+v, want refsChanged", ev)
	}

	files := reviewFiles(t, client, repoID, "feature", "main")
	entry, ok := findEntry(files.Files, "a.txt")
	if !ok {
		t.Fatal("a.txt's review record disappeared after an unrelated refsChanged")
	}
	if entry.Review.Kind != "full" {
		t.Fatalf("a.txt review status after refsChanged = %+v, want still full", entry.Review)
	}

	diff := reviewFileDiff(t, client, repoID, "feature", "main", "a.txt", "sinceReview")
	if diff.DeltaSource != "unchanged" {
		t.Fatalf("DeltaSource after refsChanged = %q, want unchanged (the mark must survive)", diff.DeltaSource)
	}
}
