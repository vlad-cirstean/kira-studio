package gitsession

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func skipWithoutGitQueries(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func runGitQ(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// newQueriesTestEntry opens repoDir on a fresh Conn/Registry pair over the real exec runner and
// returns the RepoEntry the query methods run against.
func newQueriesTestEntry(t *testing.T, repoDir string) *RepoEntry {
	t.Helper()
	runner := gitclient.NewExecRunner()
	registry := NewRegistry(runner)
	t.Cleanup(registry.Close)
	conn := NewConn(ConnID("queries-test-conn"), "test-client", "test-client-label", nil)
	summary, err := conn.Open(context.Background(), registry, "git", repoDir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	t.Cleanup(conn.Close)
	entry, ok := conn.Entry(summary.RepoID)
	if !ok {
		t.Fatal("conn.Entry: not held after Open")
	}
	return entry
}

// initGoToTargetRepo builds a two-commit repo: commit 1 adds "gone.txt" (present only at rev),
// commit 2 (HEAD) deletes it — the "historical" branch's own real-world cause — and adds
// "live.txt", which stays in the checkout.
func initGoToTargetRepo(t *testing.T) (dir string, rev string) {
	t.Helper()
	dir = t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	for i := 1; i <= 5; i++ {
		if err := os.WriteFile(filepath.Join(dir, "live.txt"), []byte(lineRange(1, 5)), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "live.txt"), []byte(lineRange(1, 20)), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "gone.txt"), []byte("will be deleted\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "live.txt", "gone.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base commit")
	rev = trimTrailingNL(runOutput(t, dir, "rev-parse", "HEAD"))

	runGitQ(t, dir, "rm", "-q", "gone.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "delete gone.txt")
	return dir, rev
}

func lineRange(from, to int) string {
	s := ""
	for n := from; n <= to; n++ {
		s += string(rune('0'+n%10)) + "\n"
	}
	return s
}

func trimTrailingNL(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}

func runOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// TestBlob_NewlineInRevDoesNotDesyncTheSharedSession is G31 round-2 architecture/security review
// finding #2: Blob used to sniff only `path` for a newline (the batch protocol's one-line-per-
// request limit), not `rev` — so a newline embedded in `rev` still reached the shared, persistent
// cat-file session's normal Read/Check path. Git then read the embedded newline as a SECOND
// request line, but this code only ever consumes ONE response per call, leaving a leftover
// response sitting in the session's own buffered reader — silently answering the NEXT, entirely
// unrelated caller sharing this RepoEntry's session (every connection on the repository, SPEC
// §6's split rule) with stale, misaligned data. Proven here by an evil rev followed immediately by
// an ordinary, correct call: the second call must see its own real content, not corruption left
// behind by the first.
func TestBlob_NewlineInRevDoesNotDesyncTheSharedSession(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("AAAA\n"), 0o644); err != nil {
		t.Fatalf("write a.txt: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("BBBB\n"), 0o644); err != nil {
		t.Fatalf("write b.txt: %v", err)
	}
	runGitQ(t, dir, "add", "a.txt", "b.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "add a.txt and b.txt")
	e := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	// The evil call: an embedded newline in rev. Whatever it resolves to (or fails to) is not
	// this test's concern — only that it must not corrupt the shared session for what follows.
	_, _ = e.Blob(ctx, "HEAD\nHEAD", "a.txt")

	got, err := e.Blob(ctx, "HEAD", "b.txt")
	if err != nil {
		t.Fatalf("Blob(HEAD, b.txt) after the evil call: %v", err)
	}
	if got.Kind != "found" || got.Content != "BBBB\n" {
		t.Fatalf("Blob(HEAD, b.txt) after the evil call = %+v, want {Kind:found Content:\"BBBB\\n\"} "+
			"(a mismatch here means the earlier newline-in-rev call desynced the shared cat-file session)", got)
	}
}

// TestGoToTarget_LivePresentAndUnchanged proves the "live, no drift" branch: a file on disk,
// identical to rev's own version, answers hunks=nil (never a rewritten line).
func TestGoToTarget_LivePresentAndUnchanged(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, rev := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	got, err := e.GoToTarget(context.Background(), rev, "live.txt")
	if err != nil {
		t.Fatalf("GoToTarget: %v", err)
	}
	if got.Kind != "live" {
		t.Fatalf("kind = %q, want live", got.Kind)
	}
	if got.AbsPath != filepath.Join(dir, "live.txt") {
		t.Fatalf("absPath = %q, want %q", got.AbsPath, filepath.Join(dir, "live.txt"))
	}
	if got.Hunks != nil {
		t.Fatalf("hunks = %+v, want nil (no drift since rev)", got.Hunks)
	}
}

// TestGoToTarget_LiveEditedAboveTheCursor proves the drift re-map's own hunks are non-nil once the
// checkout diverges from rev — the extension maps the caller's line across exactly these hunks.
func TestGoToTarget_LiveEditedAboveTheCursor(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, rev := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	// An uncommitted edit above line 1: insert two new lines at the top.
	if err := os.WriteFile(filepath.Join(dir, "live.txt"), []byte("NEW1\nNEW2\n"+lineRange(1, 20)), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, err := e.GoToTarget(context.Background(), rev, "live.txt")
	if err != nil {
		t.Fatalf("GoToTarget: %v", err)
	}
	if got.Kind != "live" {
		t.Fatalf("kind = %q, want live", got.Kind)
	}
	if len(got.Hunks) == 0 {
		t.Fatal("hunks empty, want a real drift hunk for the uncommitted edit")
	}
}

// TestGoToTarget_HistoricalPathNotOnDiskButBlobExists proves the "historical" branch: a path
// deleted since rev is not on disk, but its blob still exists at rev.
func TestGoToTarget_HistoricalPathNotOnDiskButBlobExists(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, rev := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	got, err := e.GoToTarget(context.Background(), rev, "gone.txt")
	if err != nil {
		t.Fatalf("GoToTarget: %v", err)
	}
	if got.Kind != "historical" || got.Rev != rev || got.Path != "gone.txt" {
		t.Fatalf("got = %+v, want historical at %s:gone.txt", got, rev)
	}
}

// TestGoToTarget_UnavailableNeitherOnDiskNorInRevision proves the third branch: a path that was
// never tracked at rev and does not exist on disk either.
func TestGoToTarget_UnavailableNeitherOnDiskNorInRevision(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, rev := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	got, err := e.GoToTarget(context.Background(), rev, "never-existed.txt")
	if err != nil {
		t.Fatalf("GoToTarget: %v", err)
	}
	if got.Kind != "unavailable" || got.Reason != "notInRevision" {
		t.Fatalf("got = %+v, want unavailable/notInRevision", got)
	}
}

// TestGoToTarget_PathEscapingRootIsRefused proves the one place this phase resolves a path
// against a worktree root refuses one that escapes it (F11).
func TestGoToTarget_PathEscapingRootIsRefused(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, rev := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	_, err := e.GoToTarget(context.Background(), rev, "../../etc/passwd")
	if err != ErrPathEscapesRoot {
		t.Fatalf("err = %v, want ErrPathEscapesRoot", err)
	}
}

// TestGoToTarget_BareRepoAlwaysTakesTheHistoricalBranch proves a bare repository (Root == "",
// F11's own case) never reaches the on-disk check at all — it has no checkout, so the object
// database alone decides, and no host method may join(repoId, path) against a bare repo's own
// RepoID (which is the git dir, not a worktree root, G3 D7).
func TestGoToTarget_BareRepoAlwaysTakesTheHistoricalBranch(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	srcDir, rev := initGoToTargetRepo(t)

	bareDir := t.TempDir() + "/bare.git"
	runGitQ(t, "", "clone", "-q", "--bare", srcDir, bareDir)
	e := newQueriesTestEntry(t, bareDir)
	if !e.Summary.IsBare || e.Summary.Root != "" {
		t.Fatalf("summary = %+v, want a bare repo with an empty Root", e.Summary)
	}

	got, err := e.GoToTarget(context.Background(), rev, "live.txt")
	if err != nil {
		t.Fatalf("GoToTarget: %v", err)
	}
	if got.Kind != "historical" || got.Rev != rev || got.Path != "live.txt" {
		t.Fatalf("got = %+v, want historical (a bare repo has no checkout to be live on)", got)
	}
	if got.AbsPath != "" {
		t.Fatalf("absPath = %q, want empty — a bare repo must never join(repoId, path)", got.AbsPath)
	}
}

// TestBlameLine_Committed proves the end-to-end path against a real repo: base commit's own line 1
// of live.txt blames to that commit, by the fixture's own committer identity.
func TestBlameLine_Committed(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, _ := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	line, err := e.BlameLine(context.Background(), "live.txt", 1)
	if err != nil {
		t.Fatalf("BlameLine: %v", err)
	}
	if line.SHA == "" || line.SHA == porcelain.UncommittedBlameSHA {
		t.Fatalf("SHA = %q, want a real committed sha", line.SHA)
	}
	if line.Author != "Test" {
		t.Fatalf("Author = %q, want %q", line.Author, "Test")
	}
	if line.Summary != "base commit" {
		t.Fatalf("Summary = %q, want %q", line.Summary, "base commit")
	}
}

// TestBlameLine_UncommittedEdit proves an unstaged on-disk edit blames to the all-zero sentinel, not
// a stale committed sha.
func TestBlameLine_UncommittedEdit(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, _ := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	if err := os.WriteFile(filepath.Join(dir, "live.txt"), []byte("EDITED\n"+lineRange(2, 20)), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	line, err := e.BlameLine(context.Background(), "live.txt", 1)
	if err != nil {
		t.Fatalf("BlameLine: %v", err)
	}
	if line.SHA != porcelain.UncommittedBlameSHA {
		t.Fatalf("SHA = %q, want the all-zero uncommitted sentinel", line.SHA)
	}
}

// TestBlameLine_PathEscapingRootIsRefused mirrors TestGoToTarget_PathEscapingRootIsRefused — a
// blame request also resolves a path against a live worktree, the identical risk GoToTarget was
// written to close.
func TestBlameLine_PathEscapingRootIsRefused(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, _ := initGoToTargetRepo(t)
	e := newQueriesTestEntry(t, dir)

	_, err := e.BlameLine(context.Background(), "../../etc/passwd", 1)
	if err != ErrPathEscapesRoot {
		t.Fatalf("err = %v, want ErrPathEscapesRoot", err)
	}
}
