package claudeheadless

import (
	"strings"
	"testing"
)

func TestCheckGitArgs(t *testing.T) {
	ok := [][]string{
		{"status", "--porcelain"},
		{"diff", "--name-only", "--diff-filter=U"},
		{"diff", "HEAD~1", "--", "a.txt"},
		{"log", "--oneline", "-5", "origin/main..HEAD"},
		{"show", "--format=%H", "HEAD"},
		{"rev-parse", "--verify", "feat/a"},
		{"merge-base", "--is-ancestor", "a", "b"},
		{"ls-files", "-u"},
		{"fetch", "-q", "origin"},
		{"fetch", "origin", "main"},
		{"rebase", "-q", "--autostash", "origin/main"},
		{"rebase", "--onto", "feat/a", "abc123", "feat/child"},
		{"rebase", "--onto=feat/a", "abc123"},
		{"rebase", "--continue"},
		{"add", "-A"},
		{"add", "--", "-odd.txt"},
		{"rm", "--cached", "a.txt"},
		{"checkout", "--ours", "--", "a.txt"},
		{"checkout", "--theirs", "a.txt"},
		{"push", "--force-with-lease", "-u", "origin", "feat/a"},
		{"push", "--force-with-lease", "origin", "feat/a:feat/a"},
	}
	for _, a := range ok {
		if err := CheckGitArgs(a, true); err != nil {
			t.Errorf("%q refused: %v", a, err)
		}
	}

	bad := map[string][]string{
		"file write":                  {"log", "--output=/home/u/.zshrc", "-1"},
		"file write abbreviated":      {"log", "--out=/tmp/x"},
		"file write on show":          {"show", "--output", "/tmp/x"},
		"upload-pack":                 {"fetch", "--upload-pack=sh -c x", "origin"},
		"upload-pack abbreviated":     {"fetch", "--upload=sh", "origin"},
		"receive-pack":                {"push", "--force-with-lease", "--receive-pack=x", "origin", "b"},
		"exec":                        {"rebase", "--exec=sh -c x", "main"},
		"exec abbreviated":            {"rebase", "--ex=sh -c x", "main"},
		"exec short stuck":            {"rebase", "-xsh", "main"},
		"exec short":                  {"rebase", "-x", "sh", "main"},
		"interactive":                 {"rebase", "-i", "main"},
		"config flag":                 {"-c", "alias.x=!sh", "x"},
		"config env":                  {"--config-env=a=b", "status"},
		"chdir":                       {"-C", "/", "status"},
		"config subcommand":           {"config", "core.hooksPath", "/x"},
		"unknown subcommand":          {"clone", "x"},
		"no-index reads any file":     {"diff", "--no-index", "/etc/passwd", "x"},
		"ext transport remote":        {"fetch", "ext::sh -c x"},
		"path as remote":              {"fetch", "/tmp/evil"},
		"url as remote":               {"fetch", "https://x/y"},
		"fetch refspec":               {"fetch", "origin", "x:y"},
		"revision that is an option":  {"log", "-O/tmp/x"},
		"path without separator":      {"diff", "../../etc/passwd"},
		"rebase mode with extra":      {"rebase", "--continue", "--exec=x"},
		"rebase onto option":          {"rebase", "--onto", "--exec=x", "a"},
		"rebase nothing":              {"rebase", "-q"},
		"checkout branch":             {"checkout", "main"},
		"checkout option path":        {"checkout", "--ours", "-f"},
		"checkout no path":            {"checkout", "--ours", "--"},
		"push without lease":          {"push", "origin", "feat/a"},
		"push force":                  {"push", "--force", "origin", "feat/a"},
		"push delete":                 {"push", "--force-with-lease", "origin", ":feat/a"},
		"push tag":                    {"push", "--force-with-lease", "origin", "refs/tags/v1"},
		"push plus refspec":           {"push", "--force-with-lease", "origin", "+feat/a"},
		"push mirror":                 {"push", "--force-with-lease", "--mirror", "origin"},
		"rm force":                    {"rm", "-f", "a"},
		"add intent":                  {"add", "-N", "a"},
		"add path option":             {"add", "--chmod=+x", "a"},
		"empty":                       {},
		"nul":                         {"status", "a\x00b"},
		"status path option":          {"status", "--ignore-submodules"},
		"diff ext":                    {"diff", "--ext-diff"},
		"diff textconv":               {"diff", "--textconv"},
		"log format with output flag": {"log", "--format=x", "--output=y"},
	}
	for name, a := range bad {
		if err := CheckGitArgs(a, true); err == nil {
			t.Errorf("%s: %q allowed", name, a)
		}
	}

	if err := CheckGitArgs([]string{"push", "--force-with-lease", "origin", "feat/a"}, false); err == nil {
		t.Error("push allowed with push off")
	}
}

func TestGitArgvPlain(t *testing.T) {
	got := strings.Join(gitArgv("/wt", []string{"diff", "HEAD"}), " ")
	if got != "-C /wt --no-pager diff --no-ext-diff --no-textconv HEAD" {
		t.Fatalf("argv = %q", got)
	}
}
