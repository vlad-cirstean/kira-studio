package gitops

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

func readTrimmed(path string) *string {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	trimmed := strings.TrimSpace(string(b))
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ReadInProgressStateFiles reads all nine per-worktree state files off gitDir — NEVER commonDir
// (D9): every one of these lives per-worktree, and in a linked worktree that is
// <commonDir>/worktrees/<name>/, exactly what gitDir already is. A missing file is the zero value,
// never an error — os.ReadFile's error is swallowed by design, since "not there" is the answer
// 99% of the time and ClassifyInProgress has no use for the distinction. AUTO_MERGE is
// deliberately not read: upstream's probe P4 found it left behind after an aborted cherry-pick, a
// stale artefact rather than a state signal.
//
// The nine reads run sequentially, not concurrently (F18/D9): stat/read calls on files almost
// certainly in the page cache, and a goroutine fan-out here would be a JavaScript Promise.all
// idiom for an I/O model Go does not have.
func ReadInProgressStateFiles(gitDir string) gitpreflight.InProgressStateFiles {
	return gitpreflight.InProgressStateFiles{
		MergeHead:      readTrimmed(filepath.Join(gitDir, "MERGE_HEAD")),
		CherryPickHead: readTrimmed(filepath.Join(gitDir, "CHERRY_PICK_HEAD")),
		RevertHead:     readTrimmed(filepath.Join(gitDir, "REVERT_HEAD")),
		BisectLog:      pathExists(filepath.Join(gitDir, "BISECT_LOG")),
		RebaseMergeDir: pathExists(filepath.Join(gitDir, "rebase-merge")),
		RebaseApplyDir: pathExists(filepath.Join(gitDir, "rebase-apply")),
		RebaseHeadName: readTrimmed(filepath.Join(gitDir, "rebase-merge", "head-name")),
		RebaseOnto:     readTrimmed(filepath.Join(gitDir, "rebase-merge", "onto")),
		SequencerDir:   pathExists(filepath.Join(gitDir, "sequencer")),
	}
}

// ContinueArgs is the Ordering table's own --continue column: (nil, false) for the two kinds v1
// never offers it for (rebase — §9's report-only instruction; bisect — nothing to continue) and
// for unmergedOnly (no state file to advance). The caller (gitsession.RunOp) treats false as
// "refuse before spawning", matching InProgressOperation.CanContinue.
func ContinueArgs(kind gitpreflight.InProgressKind) ([]string, bool) {
	switch kind {
	case gitpreflight.InProgressMerge:
		return []string{"merge", "--continue"}, true
	case gitpreflight.InProgressCherryPick:
		return []string{"cherry-pick", "--continue"}, true
	case gitpreflight.InProgressRevert:
		return []string{"revert", "--continue"}, true
	default:
		return nil, false
	}
}

// AbortArgs is the Ordering table's own --abort column: every kind except unmergedOnly (there is
// no state file for git to abort — InProgressOperation.CanAbort is false for exactly that kind).
// bisect's "abort" is `git bisect reset` (bisect has no --abort flag).
func AbortArgs(kind gitpreflight.InProgressKind) ([]string, bool) {
	switch kind {
	case gitpreflight.InProgressMerge:
		return []string{"merge", "--abort"}, true
	case gitpreflight.InProgressCherryPick:
		return []string{"cherry-pick", "--abort"}, true
	case gitpreflight.InProgressRevert:
		return []string{"revert", "--abort"}, true
	case gitpreflight.InProgressRebase:
		return []string{"rebase", "--abort"}, true
	case gitpreflight.InProgressBisect:
		return []string{"bisect", "reset"}, true
	default:
		return nil, false
	}
}

// SkipArgs is probe P6's own sequencer remedy for an empty pick or revert — (nil, false) for every
// other kind, since InProgressOperation.CanSkip is the UI's own gate and this is only the second
// line of defence, not the first.
func SkipArgs(kind gitpreflight.InProgressKind) ([]string, bool) {
	switch kind {
	case gitpreflight.InProgressCherryPick:
		return []string{"cherry-pick", "--skip"}, true
	case gitpreflight.InProgressRevert:
		return []string{"revert", "--skip"}, true
	default:
		return nil, false
	}
}
