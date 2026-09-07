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

// fixtureEnv is D15's own fix (F13): every spawn this builder makes gets its identity/config
// entirely from its own argv/env, never the machine's — GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM point
// at /dev/null so this container's own commit.gpgsign=true/gpg.format=ssh global config (which
// silently signed every fixture commit, making the corpus reproducible only on this machine) can
// never leak in, and -c commit.gpgsign=false on every commit is belt-and-suspenders against a
// user- or system-level override GIT_CONFIG_GLOBAL=/dev/null does not reach (e.g. a distro's own
// /etc/gitconfig, which GIT_CONFIG_SYSTEM=/dev/null already blanks, but stated for both since
// either alone would have hidden this bug).
func fixtureEnv() []string {
	return append(os.Environ(),
		"GIT_AUTHOR_NAME="+fixtureAuthorName, "GIT_AUTHOR_EMAIL="+fixtureAuthorEmail,
		"GIT_COMMITTER_NAME="+fixtureAuthorName, "GIT_COMMITTER_EMAIL="+fixtureAuthorEmail,
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
}

func (b *repoBuilder) git(args ...string) string {
	b.t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = b.dir
	cmd.Env = fixtureEnv()
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
	cmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message, "--allow-empty-message")
	cmd.Dir = b.dir
	cmd.Env = append(fixtureEnv(), "GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when)
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
	cmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "--cleanup=verbatim", "-m", message, "--allow-empty-message")
	cmd.Dir = b.dir
	cmd.Env = append(fixtureEnv(), "GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when)
	if out, err := cmd.CombinedOutput(); err != nil {
		b.t.Fatalf("git commit --cleanup=verbatim: %v\n%s", err, out)
	}
	return b.rev("HEAD")
}

// merge merges refs into the current branch with an explicit, fixed-date merge commit.
func (b *repoBuilder) merge(message string, refs ...string) string {
	b.t.Helper()
	when := b.commitTime().Format(time.RFC3339)
	args := append([]string{"-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", message}, refs...)
	cmd := exec.Command("git", args...)
	cmd.Dir = b.dir
	cmd.Env = append(fixtureEnv(), "GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when)
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

// --- G4's own additions: staged multi-step commits (diffTree/diff/show need scenarios a single
// commit() call cannot build), a mode-only change, a type change, and a deterministically signed
// commit. ---

func (b *repoBuilder) writeFile(name, content string) {
	b.t.Helper()
	if err := os.WriteFile(filepath.Join(b.dir, name), []byte(content), 0o644); err != nil {
		b.t.Fatalf("write %s: %v", name, err)
	}
}

func (b *repoBuilder) add(paths ...string) { b.git(append([]string{"add"}, paths...)...) }
func (b *repoBuilder) mv(from, to string)  { b.git("mv", from, to) }
func (b *repoBuilder) rmFile(path string)  { b.git("rm", "-q", path) }

func (b *repoBuilder) chmodExecutable(name string) {
	b.t.Helper()
	if err := os.Chmod(filepath.Join(b.dir, name), 0o755); err != nil {
		b.t.Fatalf("chmod %s: %v", name, err)
	}
}

// replaceWithSymlink removes name (already tracked as a regular file) and recreates it as a
// symlink — the "T" (type change) name-status letter's own real-world cause.
func (b *repoBuilder) replaceWithSymlink(name, target string) {
	b.t.Helper()
	full := filepath.Join(b.dir, name)
	if err := os.Remove(full); err != nil {
		b.t.Fatalf("remove %s: %v", name, err)
	}
	if err := os.Symlink(target, full); err != nil {
		b.t.Fatalf("symlink %s: %v", name, err)
	}
}

// commitStaged commits whatever is currently staged, at a fixed, strictly increasing date — the
// multi-file-op counterpart to commit() (which stages exactly one new/changed file itself).
func (b *repoBuilder) commitStaged(message string) string {
	b.t.Helper()
	when := b.commitTime().Format(time.RFC3339)
	cmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message, "--allow-empty-message")
	cmd.Dir = b.dir
	cmd.Env = append(fixtureEnv(), "GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when)
	if out, err := cmd.CombinedOutput(); err != nil {
		b.t.Fatalf("git commit: %v\n%s", err, out)
	}
	return b.rev("HEAD")
}

// commitSigned adds name/content and commits it SSH-signed against testdata/keys/
// fixtureSigningKey — a fixed, checked-in, throwaway key (never the machine's own, per D15/
// AGENTS.md), so the resulting signature bytes, and therefore the commit's own sha, are
// reproducible across machines and reruns. The key is copied to a fresh 0600 temp file first:
// ssh-keygen (which `git`'s own gpg.format=ssh shells out to for the actual signing) refuses a
// key file with group/other permissions, and a git checkout does not reliably preserve the
// committed file's exact mode bits.
func (b *repoBuilder) commitSigned(name, content, message string) string {
	b.t.Helper()
	if _, err := exec.LookPath("ssh-keygen"); err != nil {
		b.t.Skip("ssh-keygen not on PATH — needed by git's own gpg.format=ssh signing")
	}
	keyBytes, err := os.ReadFile(filepath.Join("testdata", "keys", "fixtureSigningKey"))
	if err != nil {
		b.t.Fatalf("read fixture signing key: %v", err)
	}
	keyPath := filepath.Join(b.t.TempDir(), "signingKey")
	if err := os.WriteFile(keyPath, keyBytes, 0o600); err != nil {
		b.t.Fatalf("write temp signing key: %v", err)
	}

	b.writeFile(name, content)
	b.add(name)
	when := b.commitTime().Format(time.RFC3339)
	cmd := exec.Command("git",
		"-c", "gpg.format=ssh", "-c", "user.signingkey="+keyPath, "-c", "commit.gpgsign=true",
		"commit", "-q", "-m", message, "--allow-empty-message")
	cmd.Dir = b.dir
	cmd.Env = append(fixtureEnv(), "GIT_AUTHOR_DATE="+when, "GIT_COMMITTER_DATE="+when)
	if out, err := cmd.CombinedOutput(); err != nil {
		b.t.Fatalf("git commit (signed): %v\n%s", err, out)
	}
	return b.rev("HEAD")
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

func strPtr(s string) *string { return &s }

// captureNumstat/captureNameStatus/captureFileDiff/captureShowBodyAndSignature run the real,
// production argv builders (porcelain.NumstatArgs/NameStatusArgs/FileDiffArgs/
// ShowBodyAndSignatureArgs — never a copied argv string, D15) and return raw stdout exactly as the
// parser is fed.
func captureNumstat(t *testing.T, dir string, from *string, to string) []byte {
	t.Helper()
	return captureRaw(t, dir, porcelain.NumstatArgs(from, to))
}

func captureNameStatus(t *testing.T, dir string, from *string, to string) []byte {
	t.Helper()
	return captureRaw(t, dir, porcelain.NameStatusArgs(from, to))
}

func captureFileDiff(t *testing.T, dir string, from *string, to, path string, originalPath *string) []byte {
	t.Helper()
	return captureRaw(t, dir, porcelain.FileDiffArgs(from, to, path, originalPath))
}

func captureShowBodyAndSignature(t *testing.T, dir, sha string) []byte {
	t.Helper()
	return captureRaw(t, dir, porcelain.ShowBodyAndSignatureArgs(sha))
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

	// --- diffTree/renameWithEdit: a rename with a one-line edit (probe P1's own framing). ---
	{
		b := newRepoBuilder(t)
		content := ""
		for n := 1; n <= 20; n++ {
			content += fmt.Sprintf("%d\n", n)
		}
		parent := b.commit("old.txt", content, "add old.txt")
		b.mv("old.txt", "new.txt")
		edited := ""
		for n := 1; n <= 20; n++ {
			if n == 5 {
				edited += "CHANGED\n"
			} else {
				edited += fmt.Sprintf("%d\n", n)
			}
		}
		b.writeFile("new.txt", edited)
		b.add("new.txt")
		head := b.commitStaged("rename with edit")
		writeFixture(t, "diffTree/renameWithEdit.numstat.bin", captureNumstat(t, b.dir, &parent, head))
		writeFixture(t, "diffTree/renameWithEdit.nameStatus.bin", captureNameStatus(t, b.dir, &parent, head))
	}

	// --- diffTree/mixed: add, modify, delete, copy (source also modified, so -C alone finds it),
	// type change, and a binary file's own -\t-\t framing, all in one commit. ---
	{
		b := newRepoBuilder(t)
		b.writeFile("modified.txt", "line1\nline2\nline3\n")
		b.writeFile("deleted.txt", "to be deleted\n")
		b.writeFile("bin.dat", "\x00\x01\x02binary v1")
		copySrc := ""
		for n := 1; n <= 10; n++ {
			copySrc += fmt.Sprintf("%d\n", n)
		}
		b.writeFile("copySrc.txt", copySrc)
		b.writeFile("typechange.txt", "regular file content\n")
		b.add("modified.txt", "deleted.txt", "bin.dat", "copySrc.txt", "typechange.txt")
		parent := b.commitStaged("mixed: base")

		b.writeFile("added.txt", "brand new file\n")
		b.writeFile("modified.txt", "line1\nline2 CHANGED\nline3\n")
		b.rmFile("deleted.txt")
		copySrcModified := ""
		for n := 1; n <= 10; n++ {
			if n == 1 {
				copySrcModified += "1 CHANGED\n"
			} else {
				copySrcModified += fmt.Sprintf("%d\n", n)
			}
		}
		b.writeFile("copySrc.txt", copySrcModified)
		if err := os.WriteFile(filepath.Join(b.dir, "copyDst.txt"), []byte(copySrc), 0o644); err != nil {
			t.Fatalf("write copyDst.txt: %v", err)
		}
		b.writeFile("bin.dat", "\x00\x01\x02binary v1, modified")
		b.replaceWithSymlink("typechange.txt", "bin.dat")
		b.add("added.txt", "modified.txt", "copySrc.txt", "copyDst.txt", "bin.dat", "typechange.txt")
		head := b.commitStaged("mixed: add/modify/delete/copy/typechange/binary")

		writeFixture(t, "diffTree/mixed.numstat.bin", captureNumstat(t, b.dir, &parent, head))
		writeFixture(t, "diffTree/mixed.nameStatus.bin", captureNameStatus(t, b.dir, &parent, head))
	}

	// --- diff/*.bin: one file's own unified patch, probe P4's shapes. ---
	{
		b := newRepoBuilder(t)
		parent := b.commit("file.txt", "line1\nline2\nline3\n", "add file.txt")
		head := b.commit("file.txt", "line1\nline2 CHANGED\nline3\n", "modify file.txt")
		writeFixture(t, "diff/text.bin", captureFileDiff(t, b.dir, &parent, head, "file.txt", nil))
	}
	{
		b := newRepoBuilder(t)
		content := ""
		for n := 1; n <= 20; n++ {
			content += fmt.Sprintf("%d\n", n)
		}
		parent := b.commit("old.txt", content, "add old.txt")
		b.mv("old.txt", "new.txt")
		edited := ""
		for n := 1; n <= 20; n++ {
			if n == 5 {
				edited += "CHANGED\n"
			} else {
				edited += fmt.Sprintf("%d\n", n)
			}
		}
		b.writeFile("new.txt", edited)
		b.add("new.txt")
		head := b.commitStaged("rename with edit")
		writeFixture(t, "diff/rename.bin", captureFileDiff(t, b.dir, &parent, head, "new.txt", strPtr("old.txt")))
	}
	{
		b := newRepoBuilder(t)
		parent := b.commit("base.txt", "base\n", "base commit")
		b.writeFile("added.txt", "brand new file\n")
		b.add("added.txt")
		head := b.commitStaged("add added.txt")
		writeFixture(t, "diff/addedFile.bin", captureFileDiff(t, b.dir, &parent, head, "added.txt", nil))
	}
	{
		b := newRepoBuilder(t)
		b.commit("base.txt", "base\n", "base commit")
		parent := b.commit("gone.txt", "will be deleted\n", "add gone.txt")
		b.rmFile("gone.txt")
		head := b.commitStaged("delete gone.txt")
		writeFixture(t, "diff/deletedFile.bin", captureFileDiff(t, b.dir, &parent, head, "gone.txt", nil))
	}
	{
		b := newRepoBuilder(t)
		parent := b.commit("bin.dat", "\x00\x01\x02binary v1", "add binary")
		head := b.commit("bin.dat", "\x00\x01\x02binary v1, modified", "modify binary")
		writeFixture(t, "diff/binary.bin", captureFileDiff(t, b.dir, &parent, head, "bin.dat", nil))
	}
	{
		b := newRepoBuilder(t)
		parent := b.commit("f.txt", "hi\n", "add f.txt")
		b.chmodExecutable("f.txt")
		b.add("f.txt")
		head := b.commitStaged("mode change")
		writeFixture(t, "diff/modeOnly.bin", captureFileDiff(t, b.dir, &parent, head, "f.txt", nil))
	}
	{
		b := newRepoBuilder(t)
		parent := b.commit("nnl.txt", "no newline", "add nnl.txt")
		head := b.commit("nnl.txt", "no newline changed", "change nnl.txt")
		writeFixture(t, "diff/noNewline.bin", captureFileDiff(t, b.dir, &parent, head, "nnl.txt", nil))
	}
	{
		b := newRepoBuilder(t)
		parent := b.commit("x.txt", "unrelated\n", "add x.txt")
		lfsContent := "version https://git-lfs.github.com/spec/v1\n" +
			"oid sha256:5e44102a3521f3fea5053f4837c91589afba392a633f4c5e6ae825dc5609f706\n" +
			"size 12345\n"
		head := b.commit("asset.bin", lfsContent, "add LFS pointer")
		writeFixture(t, "diff/lfsPointer.bin", captureFileDiff(t, b.dir, &parent, head, "asset.bin", nil))
	}

	// --- show/*.bin: the %G?/%GS/%(trailers)/%b record, body last (probe P5). ---
	{
		b := newRepoBuilder(t)
		sha := b.commitSigned("signed.txt", "content\n", "Signed commit")
		writeFixture(t, "show/signed.bin", captureShowBodyAndSignature(t, b.dir, sha))
	}
	{
		b := newRepoBuilder(t)
		sha := b.commit("a.txt", "a\n",
			"Subject line\n\nBody paragraph one.\n\nReviewed-by: Alice <alice@example.com>\nSigned-off-by: Bob <bob@example.com>")
		writeFixture(t, "show/trailers.bin", captureShowBodyAndSignature(t, b.dir, sha))
	}
	{
		b := newRepoBuilder(t)
		sha := b.commit("a.txt", "a\n", "Only subject")
		writeFixture(t, "show/emptyBody.bin", captureShowBodyAndSignature(t, b.dir, sha))
	}
	{
		b := newRepoBuilder(t)
		sha := b.commit("a.txt", "a\n", "Subject line\n\nSigned-off-by: Carol <carol@example.com>")
		writeFixture(t, "show/bodyIsAllTrailers.bin", captureShowBodyAndSignature(t, b.dir, sha))
	}

	t.Log("golden corpus regenerated under testdata/ — run `bunx biome check --write` is not needed (Go-only); re-run tests without KIRA_GIT_FIXTURES to verify")
}
