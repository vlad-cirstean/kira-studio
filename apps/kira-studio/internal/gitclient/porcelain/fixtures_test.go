package porcelain_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// The golden corpus (D15): committed raw-byte recordings of real `git log`/`for-each-ref` output,
// regenerated only under KIRA_GIT_FIXTURES=write (mirroring KIRA_IPC_FIXTURES=write, AGENTS.md).
// Deterministic fixed identity + fixed dates + fixed tree content make every commit's own sha
// reproducible run to run, which is what makes a regenerated .bin byte-identical to the committed
// one.

const fixtureAuthorName = "Kira Fixture"
const fixtureAuthorEmail = "fixture@kira.test"

var fixtureBaseTime = time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC)

// repoBuilder drives a deterministic fixture repository: every commit gets the same author/
// committer identity and a strictly increasing, fixed timestamp, so the resulting tree of shas
// reproduces byte-for-byte across regenerations (and across machines, since git's default hash
// algorithm is fixed).
type repoBuilder struct {
	t    *testing.T
	dir  string
	next int
}

func newRepoBuilder(t *testing.T) *repoBuilder {
	t.Helper()
	dir := t.TempDir()
	b := &repoBuilder{t: t, dir: dir}
	b.git("init", "-q", "-b", "main")
	return b
}

func (b *repoBuilder) commitTime() time.Time {
	when := fixtureBaseTime.Add(time.Duration(b.next) * time.Minute)
	b.next++
	return when
}

func (b *repoBuilder) git(args ...string) string {
	b.t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = b.dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+fixtureAuthorName, "GIT_AUTHOR_EMAIL="+fixtureAuthorEmail,
		"GIT_COMMITTER_NAME="+fixtureAuthorName, "GIT_COMMITTER_EMAIL="+fixtureAuthorEmail,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		b.t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// commit writes name with content, stages it and commits with message, at a fixed, strictly
// increasing author/committer date — the plumbing every topology below is built from.
func (b *repoBuilder) commit(name, content, message string) string {
	b.t.Helper()
	if err := os.WriteFile(filepath.Join(b.dir, name), []byte(content), 0o644); err != nil {
		b.t.Fatalf("write %s: %v", name, err)
	}
	b.git("add", name)
	when := b.commitTime().Format(time.RFC3339)
	cmd := exec.Command("git", "commit", "-q", "-m", message, "--allow-empty-message")
	cmd.Dir = b.dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+fixtureAuthorName, "GIT_AUTHOR_EMAIL="+fixtureAuthorEmail,
		"GIT_COMMITTER_NAME="+fixtureAuthorName, "GIT_COMMITTER_EMAIL="+fixtureAuthorEmail,
		"GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		b.t.Fatalf("git commit: %v\n%s", err, out)
	}
	return b.rev("HEAD")
}

// commitVerbatim is commit, but with --cleanup=verbatim: git's default --cleanup=strip trims
// trailing whitespace (a trailing \r included) from every line, which would silently launder the
// crlfSubject fixture's whole reason for existing.
func (b *repoBuilder) commitVerbatim(name, content, message string) string {
	b.t.Helper()
	if err := os.WriteFile(filepath.Join(b.dir, name), []byte(content), 0o644); err != nil {
		b.t.Fatalf("write %s: %v", name, err)
	}
	b.git("add", name)
	when := b.commitTime().Format(time.RFC3339)
	cmd := exec.Command("git", "commit", "-q", "--cleanup=verbatim", "-m", message, "--allow-empty-message")
	cmd.Dir = b.dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+fixtureAuthorName, "GIT_AUTHOR_EMAIL="+fixtureAuthorEmail,
		"GIT_COMMITTER_NAME="+fixtureAuthorName, "GIT_COMMITTER_EMAIL="+fixtureAuthorEmail,
		"GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		b.t.Fatalf("git commit --cleanup=verbatim: %v\n%s", err, out)
	}
	return b.rev("HEAD")
}

// merge merges refs into the current branch with an explicit, fixed-date merge commit.
func (b *repoBuilder) merge(message string, refs ...string) string {
	b.t.Helper()
	when := b.commitTime().Format(time.RFC3339)
	args := append([]string{"merge", "-q", "--no-ff", "-m", message}, refs...)
	cmd := exec.Command("git", args...)
	cmd.Dir = b.dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+fixtureAuthorName, "GIT_AUTHOR_EMAIL="+fixtureAuthorEmail,
		"GIT_COMMITTER_NAME="+fixtureAuthorName, "GIT_COMMITTER_EMAIL="+fixtureAuthorEmail,
		"GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		b.t.Fatalf("git merge %v: %v\n%s", refs, err, out)
	}
	return b.rev("HEAD")
}

func (b *repoBuilder) branch(name string) { b.git("branch", name) }
func (b *repoBuilder) checkout(ref string) {
	b.git("checkout", "-q", ref)
}
func (b *repoBuilder) tag(name, ref string)      { b.git("tag", name, ref) }
func (b *repoBuilder) updateRef(ref, sha string) { b.git("update-ref", ref, sha) }
func (b *repoBuilder) rev(ref string) string {
	out := b.git("rev-parse", ref)
	return trimNL(out)
}

func trimNL(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}

// captureLog runs the real, production argv (porcelain.LogSessionArgs — never a copied string,
// D15) against dir through gitclient's own runner, and returns raw stdout bytes exactly as the
// parser is fed.
func captureLog(t *testing.T, dir string, spec porcelain.WalkSpec) []byte {
	t.Helper()
	return captureRaw(t, dir, porcelain.LogSessionArgs(spec))
}

func captureRaw(t *testing.T, dir string, args []string) []byte {
	t.Helper()
	runner := gitclient.NewExecRunner()
	res, err := gitclient.Run(context.Background(), runner, "git", gitclient.Spec{Dir: dir, Args: args, ReadOnly: true})
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	if res.ExitCode != 0 {
		t.Fatalf("git %v: exit %d: %s", args, res.ExitCode, res.Stderr)
	}
	return res.Stdout
}

func writeFixture(t *testing.T, relPath string, data []byte) {
	t.Helper()
	full := filepath.Join("testdata", relPath)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		t.Fatalf("write %s: %v", full, err)
	}
}

// TestFixtures_Regenerate is the KIRA_GIT_FIXTURES=write regenerator (D15) — the golden corpus's
// only writer. Skipped by default; every other test in this package reads the committed .bin
// files it produces.
func TestFixtures_Regenerate(t *testing.T) {
	if os.Getenv("KIRA_GIT_FIXTURES") != "write" {
		t.Skip("set KIRA_GIT_FIXTURES=write to regenerate the golden corpus")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}

	allScope := porcelain.WalkSpec{Scope: "all"}

	// --- log/linear.bin: three sequential commits, no branches, no merges. ---
	{
		b := newRepoBuilder(t)
		b.commit("a.txt", "a\n", "first commit")
		b.commit("b.txt", "b\n", "second commit")
		b.commit("c.txt", "c\n", "third commit")
		writeFixture(t, "log/linear.bin", captureLog(t, b.dir, allScope))
	}

	// --- log/branchy.bin: a merge, a surviving feature branch, a lightweight tag. ---
	{
		b := newRepoBuilder(t)
		base := b.commit("base.txt", "base\n", "base commit")
		b.tag("v1.0", base)
		b.branch("feature")
		b.checkout("feature")
		b.commit("feature.txt", "feature\n", "feature work")
		b.checkout("main")
		b.commit("main2.txt", "main2\n", "more on main")
		b.merge("merge feature into main", "feature")
		writeFixture(t, "log/branchy.bin", captureLog(t, b.dir, allScope))
	}

	// --- log/crissCross.bin: two merge commits, each with two parents, criss-crossing branches a/b. ---
	{
		b := newRepoBuilder(t)
		b.commit("base.txt", "base\n", "base commit")
		b.branch("a")
		b.branch("b")
		b.checkout("a")
		b.commit("a1.txt", "a1\n", "a1")
		b.checkout("b")
		b.commit("b1.txt", "b1\n", "b1")
		b.checkout("a")
		b.merge("merge b into a", "b")
		b.checkout("b")
		b.commit("b2.txt", "b2\n", "b2")
		b.merge("merge a into b", "a")
		writeFixture(t, "log/crissCross.bin", captureLog(t, b.dir, allScope))
	}

	// --- log/octopus.bin: one commit with three parents. ---
	{
		b := newRepoBuilder(t)
		base := b.commit("base.txt", "base\n", "base commit")
		b.branch("f1")
		b.branch("f2")
		b.checkout("f1")
		b.commit("f1.txt", "f1\n", "f1 work")
		b.checkout("f2")
		b.commit("f2.txt", "f2\n", "f2 work")
		b.checkout("main")
		_ = base
		b.merge("octopus merge", "f1", "f2")
		writeFixture(t, "log/octopus.bin", captureLog(t, b.dir, allScope))
	}

	// --- handAuthored: the four edge cases no generated topology produces on its own. ---
	{
		b := newRepoBuilder(t)
		b.commit("a.txt", "a\n", "")
		writeFixture(t, "handAuthored/emptySubject.bin", captureLog(t, b.dir, allScope))
	}
	{
		// git's own %s trims *trailing* whitespace off the subject line (confirmed against a real
		// git binary here), so a CR immediately before the line's terminating LF cannot survive it
		// — the byte worth pinning is a CR embedded mid-subject, which %s's rtrim never touches.
		b := newRepoBuilder(t)
		b.commitVerbatim("a.txt", "a\n", "Sub\rject line\r\n\r\nBody paragraph.\r\n")
		writeFixture(t, "handAuthored/crlfSubject.bin", captureLog(t, b.dir, allScope))
	}
	{
		b := newRepoBuilder(t)
		b.commit("a.txt", "a\n", fmt.Sprintf("Weird%cSubject", 0x1f))
		writeFixture(t, "handAuthored/subjectWith0x1f.bin", captureLog(t, b.dir, allScope))
	}
	{
		b := newRepoBuilder(t)
		sha := b.commit("a.txt", "a\n", "fully decorated commit")
		b.branch("other-branch")
		b.tag("v2.0", sha)
		b.updateRef("refs/remotes/origin/main", sha)
		b.updateRef("refs/stash", sha)
		writeFixture(t, "handAuthored/fullDecoration.bin", captureLog(t, b.dir, allScope))
	}

	t.Log("golden corpus regenerated under testdata/ — run `bunx biome check --write` is not needed (Go-only); re-run tests without KIRA_GIT_FIXTURES to verify")
}
