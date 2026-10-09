package flowharness

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// baseTime is the first commit's timestamp; each later commit in a Repo is one minute after.
const baseTime = 1_700_000_000

// Repo is a real git repository. Every method runs the real git binary with fixed dates and
// identity, so shas are reproducible across runs.
type Repo struct {
	t   testing.TB
	Dir string
	n   int
}

// gitEnv pins identity and dates; HOME and the system config are the harness's isolated ones.
func gitEnv(ts int) []string {
	date := fmt.Sprintf("@%d +0000", ts)
	return append(os.Environ(),
		"GIT_AUTHOR_NAME=Test Author", "GIT_AUTHOR_EMAIL=author@example.com",
		"GIT_COMMITTER_NAME=Test Author", "GIT_COMMITTER_EMAIL=author@example.com",
		"GIT_AUTHOR_DATE="+date, "GIT_COMMITTER_DATE="+date,
		"GIT_TERMINAL_PROMPT=0",
	)
}

func runGit(t testing.TB, dir string, env []string, stdin []byte, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = env
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return strings.TrimRight(out.String(), "\n"), fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, errb.String())
	}
	return strings.TrimRight(out.String(), "\n"), nil
}

// NewRepo creates an empty repository on branch main under dir (created when missing).
func NewRepo(t testing.TB, dir string) *Repo {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	r := &Repo{t: t, Dir: dir}
	r.Git("init", "-q", "-b", "main")
	return r
}

// Git runs git in the repository and returns trimmed stdout, failing the test on error.
func (r *Repo) Git(args ...string) string {
	r.t.Helper()
	out, err := r.GitErr(args...)
	if err != nil {
		r.t.Fatal(err)
	}
	return out
}

// GitErr is Git returning the error instead of failing.
func (r *Repo) GitErr(args ...string) (string, error) {
	r.t.Helper()
	return runGit(r.t, r.Dir, gitEnv(baseTime+60*r.n), nil, args...)
}

// Write writes a file relative to the repository root, creating directories.
func (r *Repo) Write(rel, content string) {
	r.t.Helper()
	p := filepath.Join(r.Dir, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		r.t.Fatal(err)
	}
}

// Commit writes files, stages everything and commits, one minute after the previous commit.
func (r *Repo) Commit(msg string, files map[string]string) string {
	r.t.Helper()
	for rel, content := range files {
		r.Write(rel, content)
	}
	r.n++
	r.Git("add", "-A")
	r.Git("commit", "-q", "--allow-empty", "-m", msg)
	return r.Git("rev-parse", "HEAD")
}

// Branch creates a branch at from (HEAD when empty) without switching.
func (r *Repo) Branch(name, from string) {
	r.t.Helper()
	if from == "" {
		from = "HEAD"
	}
	r.Git("branch", name, from)
}

// Tag creates a lightweight tag at HEAD.
func (r *Repo) Tag(name string) { r.t.Helper(); r.Git("tag", name) }

// Checkout switches to ref.
func (r *Repo) Checkout(ref string) { r.t.Helper(); r.Git("checkout", "-q", ref) }

// Merge merges branch with --no-ff and returns the merge commit sha.
func (r *Repo) Merge(branch, msg string) string {
	r.t.Helper()
	r.n++
	r.Git("merge", "-q", "--no-ff", "-m", msg, branch)
	return r.Git("rev-parse", "HEAD")
}

// Rename moves a tracked file with git mv and commits it.
func (r *Repo) Rename(oldRel, newRel, msg string) string {
	r.t.Helper()
	if err := os.MkdirAll(filepath.Dir(filepath.Join(r.Dir, newRel)), 0o755); err != nil {
		r.t.Fatal(err)
	}
	r.Git("mv", oldRel, newRel)
	r.n++
	r.Git("commit", "-q", "-m", msg)
	return r.Git("rev-parse", "HEAD")
}

// WriteBinary writes a file with a NUL byte so git treats it as binary.
func (r *Repo) WriteBinary(rel string, size int) {
	r.t.Helper()
	b := make([]byte, size)
	for i := range b {
		b[i] = byte(i % 251)
	}
	b[0] = 0
	p := filepath.Join(r.Dir, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatal(err)
	}
	if err := os.WriteFile(p, b, 0o644); err != nil {
		r.t.Fatal(err)
	}
}

// NFDName is "café" with a combining accent (NFD), the spelling macOS file systems produce.
const NFDName = "café"

// Conflict leaves the working tree mid-merge: branchA and branchB both changed path differently
// from main's version. It checks out branchA and merges branchB, which stops on the conflict.
func (r *Repo) Conflict(branchA, branchB, path string) {
	r.t.Helper()
	base := r.Git("rev-parse", "HEAD")
	r.Git("checkout", "-q", "-b", branchA, base)
	r.Commit("change "+path+" on "+branchA, map[string]string{path: "a side\n"})
	r.Git("checkout", "-q", "-b", branchB, base)
	r.Commit("change "+path+" on "+branchB, map[string]string{path: "b side\n"})
	r.Git("checkout", "-q", branchA)
	if _, err := r.GitErr("merge", "-q", "--no-ff", "-m", "merge "+branchB, branchB); err == nil {
		r.t.Fatalf("merge %s into %s did not conflict", branchB, branchA)
	}
}

// RevList is the oracle: git rev-list with args, one sha per element.
func (r *Repo) RevList(args ...string) []string {
	r.t.Helper()
	out := r.Git(append([]string{"rev-list"}, args...)...)
	if out == "" {
		return nil
	}
	return strings.Split(out, "\n")
}

// AddRemote adds origin pointing at url.
func (r *Repo) AddRemote(url string) { r.t.Helper(); r.Git("remote", "add", "origin", url) }

// BadRemote adds an origin that cannot be reached: a file:// path that does not exist.
func (r *Repo) BadRemote() {
	r.t.Helper()
	r.AddRemote("file://" + filepath.Join(r.Dir, "no-such-remote.git"))
}

// LinkedWorktree adds a linked worktree on a new branch next to the repository and returns it.
func (r *Repo) LinkedWorktree(branch string) *Repo {
	r.t.Helper()
	dir := filepath.Join(filepath.Dir(r.Dir), filepath.Base(r.Dir)+"-wt-"+strings.ReplaceAll(branch, "/", "-"))
	r.Git("worktree", "add", "-q", "-b", branch, dir)
	return &Repo{t: r.t, Dir: dir, n: r.n}
}

// Bare is a bare repository used as a remote.
type Bare struct {
	t   testing.TB
	Dir string
}

// BareRemote creates an empty bare repository whose HEAD is main.
func BareRemote(t testing.TB, dir string) *Bare {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(t, dir, gitEnv(baseTime), nil, "init", "-q", "--bare", "-b", "main"); err != nil {
		t.Fatal(err)
	}
	return &Bare{t: t, Dir: dir}
}

// Git runs git in the bare repository.
func (b *Bare) Git(args ...string) string {
	b.t.Helper()
	out, err := runGit(b.t, b.Dir, gitEnv(baseTime), nil, args...)
	if err != nil {
		b.t.Fatal(err)
	}
	return out
}

// Clone clones the bare remote into dir; origin is the bare repository.
func (b *Bare) Clone(dir string) *Repo {
	b.t.Helper()
	if _, err := runGit(b.t, filepath.Dir(dir), gitEnv(baseTime), nil, "clone", "-q", b.Dir, dir); err != nil {
		b.t.Fatal(err)
	}
	return &Repo{t: b.t, Dir: dir, n: 1000}
}

// PushFrom pushes every branch of r to origin of the bare repository, adding the remote if needed.
func (b *Bare) PushFrom(r *Repo) {
	r.t.Helper()
	if _, err := r.GitErr("remote", "get-url", "origin"); err != nil {
		r.AddRemote(b.Dir)
	}
	r.Git("push", "-q", "origin", "--all")
}

// HistorySpec describes a generated history.
type HistorySpec struct {
	// Commits is the total commit count.
	Commits int
	// Branches is how many branches the commits round-robin over; main is branch 0.
	Branches int
	// MergeEvery makes every Nth main commit a merge of another branch's tip; 0 means none.
	MergeEvery int
}

// History builds a repository from spec with git fast-import and checks main out. Built once per
// test binary per spec and copied, so asking for the same history in many tests costs one build.
func History(t testing.TB, dir string, spec HistorySpec) *Repo {
	t.Helper()
	tmpl := template(t, fmt.Sprintf("history-%d-%d-%d", spec.Commits, spec.Branches, spec.MergeEvery), func(dst string) {
		buildHistory(t, dst, spec)
	})
	copyTree(t, tmpl, dir)
	return &Repo{t: t, Dir: dir, n: spec.Commits}
}

func buildHistory(t testing.TB, dir string, spec HistorySpec) {
	t.Helper()
	NewRepo(t, dir)
	branches := max(spec.Branches, 1)
	name := func(b int) string {
		if b == 0 {
			return "main"
		}
		return fmt.Sprintf("topic-%d", b)
	}
	var script bytes.Buffer
	last := make([]int, branches) // last mark per branch, 0 = none yet
	mergeTurn := 1
	for i := 1; i <= spec.Commits; i++ {
		b := i % branches
		msg := fmt.Sprintf("commit %d on %s", i, name(b))
		content := fmt.Sprintf("%d\n", i)
		fmt.Fprintf(&script, "commit refs/heads/%s\nmark :%d\n", name(b), i)
		ts := baseTime + 60*i
		fmt.Fprintf(&script, "author Test Author <author@example.com> %d +0000\n", ts)
		fmt.Fprintf(&script, "committer Test Author <author@example.com> %d +0000\n", ts)
		fmt.Fprintf(&script, "data %d\n%s\n", len(msg), msg)
		switch {
		case last[b] != 0:
			fmt.Fprintf(&script, "from :%d\n", last[b])
		case b != 0 && last[0] != 0:
			fmt.Fprintf(&script, "from :%d\n", last[0])
		}
		if b == 0 && spec.MergeEvery > 0 && i%spec.MergeEvery == 0 && branches > 1 {
			for tries := 0; tries < branches; tries++ {
				other := 1 + (mergeTurn+tries)%(branches-1)
				if last[other] != 0 {
					fmt.Fprintf(&script, "merge :%d\n", last[other])
					mergeTurn++
					break
				}
			}
		}
		fmt.Fprintf(&script, "M 100644 inline f%d.txt\ndata %d\n%s\n", b, len(content), content)
		last[b] = i
	}
	if _, err := runGit(t, dir, gitEnv(baseTime), script.Bytes(), "fast-import", "--quiet"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(t, dir, gitEnv(baseTime), nil, "checkout", "-q", "-f", "main"); err != nil {
		t.Fatal(err)
	}
}

var (
	tmplMu   sync.Mutex
	tmplRoot string
	tmplDone = map[string]string{}
)

// template builds a directory once per test binary with build and returns its path.
func template(t testing.TB, key string, build func(dst string)) string {
	t.Helper()
	tmplMu.Lock()
	defer tmplMu.Unlock()
	if p, ok := tmplDone[key]; ok {
		return p
	}
	if tmplRoot == "" {
		root, err := os.MkdirTemp("", "ksft")
		if err != nil {
			t.Fatal(err)
		}
		tmplRoot = root
	}
	dst := filepath.Join(tmplRoot, fmt.Sprintf("t%d", len(tmplDone)))
	build(dst)
	tmplDone[key] = dst
	return dst
}

// removeTemplates deletes the per-binary template root; Main calls it after the run.
func removeTemplates() {
	tmplMu.Lock()
	defer tmplMu.Unlock()
	if tmplRoot != "" {
		_ = os.RemoveAll(tmplRoot)
		tmplRoot = ""
	}
}

func copyTree(t testing.TB, src, dst string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("cp", "-a", src, dst).CombinedOutput(); err != nil {
		t.Fatalf("cp -a %s %s: %v\n%s", src, dst, err, out)
	}
}
