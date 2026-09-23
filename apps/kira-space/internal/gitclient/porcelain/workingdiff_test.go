package porcelain_test

import (
	"context"
	"os"
	"os/exec"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
)

// TestParseWorkingDiff_Mixed confirms ParseNumstatRecords/ParseNameStatusRecords/CombineFileChanges
// — established against diff-tree output — parse plain `git diff`'s identical `-z` framing without
// any change: a staged add and an unstaged modify against HEAD, both combined into one spawn (P7,
// item 2's own "one diff HEAD covers both" design).
func TestParseWorkingDiff_Mixed(t *testing.T) {
	t.Parallel()
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "workingDiff/mixed.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "workingDiff/mixed.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != 2 {
		t.Fatalf("got %d combined rows, want 2 (a.txt modified, staged.txt added)", len(combined))
	}
	byPath := make(map[string]porcelain.FileChange, len(combined))
	for _, fc := range combined {
		byPath[fc.Path] = fc
	}
	if fc, ok := byPath["a.txt"]; !ok || fc.Kind != porcelain.FileModified {
		t.Fatalf("a.txt = %+v, ok=%v, want modified", fc, ok)
	}
	if fc, ok := byPath["staged.txt"]; !ok || fc.Kind != porcelain.FileAdded {
		t.Fatalf("staged.txt = %+v, ok=%v, want added", fc, ok)
	}
}

// TestParseWorkingDiff_UnstagedRename confirms -M still detects a rename that is on disk but never
// staged — the one shape commit.detail's own diff-tree fixtures cannot produce, since a rename
// there is always already staged into a commit.
func TestParseWorkingDiff_UnstagedRename(t *testing.T) {
	t.Parallel()
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "workingDiff/renamed.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "workingDiff/renamed.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != 1 {
		t.Fatalf("got %d combined rows, want 1", len(combined))
	}
	fc := combined[0]
	if fc.Kind != porcelain.FileRenamed || fc.Path != "renamed.txt" || !strPtrEq(fc.OriginalPath, "old.txt") {
		t.Fatalf("combined[0] = %+v, want renamed old.txt -> renamed.txt", fc)
	}
}

// TestParseWorkingDiff_UnbornHead confirms the empty-tree hash (EmptyTreeHashArgs, F18) works as
// the base against a fresh, zero-commit repo — gitsession.WorkingDetail's own base-selection
// branch for statusResult.Branch.Unborn.
func TestParseWorkingDiff_UnbornHead(t *testing.T) {
	t.Parallel()
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "workingDiff/unbornHead.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "workingDiff/unbornHead.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != 1 || combined[0].Kind != porcelain.FileAdded || combined[0].Path != "staged.txt" {
		t.Fatalf("combined = %+v, want one added staged.txt", combined)
	}
}

// TestEmptyTreeHashArgs_MatchesRepositoryObjectFormat is F18's own regression guard: the old
// design hardcoded the SHA-1-width empty-tree hash as a literal constant, silently wrong in a
// SHA-256 repository (verified against real git --object-format=sha256: a completely different,
// 64-hex value, never just a longer version of the SHA-1 one). EmptyTreeHashArgs derives it from
// this repository's own object format instead, via a real spawn — checked against both.
func TestEmptyTreeHashArgs_MatchesRepositoryObjectFormat(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	runner := gitclient.NewExecRunner()

	t.Run("sha1", func(t *testing.T) {
		dir := t.TempDir()
		requireGitInit(t, dir)
		res, err := gitclient.Run(context.Background(), runner, "git", gitclient.Spec{Dir: dir, Args: porcelain.EmptyTreeHashArgs(), ReadOnly: true})
		if err != nil || res.ExitCode != 0 {
			t.Fatalf("EmptyTreeHashArgs: err=%v exit=%d stderr=%s", err, res.ExitCode, res.Stderr)
		}
		got := porcelain.ParseEmptyTreeHash(res.Stdout)
		want := "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
		if got != want {
			t.Fatalf("empty-tree hash = %q, want %q (SHA-1)", got, want)
		}
	})

	t.Run("sha256", func(t *testing.T) {
		dir := t.TempDir()
		cmd := exec.Command("git", "init", "-q", "--object-format=sha256", "-b", "main")
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Skipf("this git build does not support --object-format=sha256: %v\n%s", err, out)
		}
		res, err := gitclient.Run(context.Background(), runner, "git", gitclient.Spec{Dir: dir, Args: porcelain.EmptyTreeHashArgs(), ReadOnly: true})
		if err != nil || res.ExitCode != 0 {
			t.Fatalf("EmptyTreeHashArgs: err=%v exit=%d stderr=%s", err, res.ExitCode, res.Stderr)
		}
		got := porcelain.ParseEmptyTreeHash(res.Stdout)
		want := "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321"
		if got != want {
			t.Fatalf("empty-tree hash = %q, want %q (SHA-256) — a hardcoded SHA-1-width literal would have been wrong here", got, want)
		}
	})
}

func requireGitInit(t *testing.T, dir string) {
	t.Helper()
	cmd := exec.Command("git", "init", "-q", "-b", "main")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
}
