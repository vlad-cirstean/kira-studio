package gitsock

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// fixtureRepoScaffold is buildOpsFixtureRepo's and buildReviewFixtureRepo's own shared setup
// (P107 I2-28, byte-identical apart from allowEmptyMessage): skip without git, a temp dir, and
// run/writeFile/commit closures against it, isolated via opsFixtureEnv
// (GIT_CONFIG_GLOBAL/SYSTEM=/dev/null, gpgsign off). allowEmptyMessage matches ops's own
// --allow-empty-message — review's own commit never passes it, and reviewFixture never needs an
// empty-message commit. detail_test.go's and review_test.go's own buildAskFixtureRepo diverge in
// real ways (a different env func, closures missing t.Helper(), commit built inline rather than
// via a closure) and stay their own, undisturbed implementations.
func fixtureRepoScaffold(t *testing.T, allowEmptyMessage bool) (dir string, run func(args ...string) string, writeFile func(name, content string), commit func(msg string) string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir = t.TempDir()

	run = func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	writeFile = func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	commit = func(msg string) string {
		t.Helper()
		args := []string{"-c", "commit.gpgsign=false", "commit", "-q", "-m", msg}
		if allowEmptyMessage {
			args = append(args, "--allow-empty-message")
		}
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git commit: %v\n%s", err, out)
		}
		return trimNewline(run("rev-parse", "HEAD"))
	}
	return dir, run, writeFile, commit
}
