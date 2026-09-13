package gitsock

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// G17 §7.1.6's own end-to-end proof: stash.list/stash.show/preflight.stashPop/
// preflight.stashBranch and all five op.run stash kinds over a real socket against a real
// fixture repository, including the one deliberately conflicting stashPop this phase's own D6
// reclassification exists for.

func stashRunGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func stashWriteFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// stashRequestOK/stashOpRunOK are requestOK/opRunOK's own tolerant twins (ops_test.go's own
// requestIgnoringEvents doc comment): this file's own tests issue many op.run writes back to back
// on ONE connection that also holds a live repo.changed subscription on the same repo, so an
// unsolicited 'evt' frame can legitimately land between a request and its matching response.
func stashRequestOK(t *testing.T, c *testClient, method string, params any) wireFrame {
	t.Helper()
	resp := requestIgnoringEvents(t, c, method, params)
	if resp.T != "res" || resp.OK == nil || !*resp.OK {
		t.Fatalf("%s: got %+v", method, resp)
	}
	return resp
}

func stashOpRunOK(t *testing.T, c *testClient, repoID string, op gitsession.OpRequest) gitsession.OpResult {
	t.Helper()
	resp := stashRequestOK(t, c, "op.run", gitrpc.OpRunParams{RepoID: repoID, Op: op})
	return unmarshalResult[gitsession.OpResult](t, resp.Result)
}

func stashListOK(t *testing.T, c *testClient, repoID string) []porcelain.StashEntry {
	t.Helper()
	resp := stashRequestOK(t, c, "stash.list", gitrpc.StashListParams{RepoID: repoID})
	return unmarshalResult[gitrpc.StashListResult](t, resp.Result).Entries
}

// TestIntegration_StashListShowAndCleanOps drives the clean-path flow: push (with an untracked
// file), list, show, a clean pop preflight, apply (keeps the stash), pop (removes it), push again
// then branch (also removes it, per real `stash branch stash@{index}` behaviour), push a third time
// then drop (undoable — G17's own addition to the undo slot) and undo it back.
func TestIntegration_StashListShowAndCleanOps(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	stashRunGit(t, dir, "init", "-q", "-b", "main")
	stashWriteFile(t, dir, "a.txt", "line1\nline2\nline3\n")
	stashRunGit(t, dir, "add", "a.txt")
	stashRunGit(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "stash-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	// --- push, with an untracked file alongside a tracked edit. ---
	stashWriteFile(t, dir, "a.txt", "line1\nmodified\nline3\n")
	stashWriteFile(t, dir, "u.txt", "untracked\n")
	pushResult := stashOpRunOK(t, client, repoID, gitsession.OpRequest{
		Kind: "stashPush", IncludeUntracked: true, KeepIndex: false, Paths: []string{},
	})
	if !pushResult.OK {
		t.Fatalf("stashPush failed: %+v", pushResult)
	}

	entries := stashListOK(t, client, repoID)
	if len(entries) != 1 {
		t.Fatalf("stash.list after push = %+v, want 1 entry", entries)
	}
	entry := entries[0]
	if entry.Branch == nil || *entry.Branch != "main" {
		t.Fatalf("entry.Branch = %v, want \"main\"", entry.Branch)
	}
	if !entry.IncludedUntracked || entry.UntrackedSha == nil {
		t.Fatalf("entry.IncludedUntracked/UntrackedSha = %v/%v, want true/non-nil", entry.IncludedUntracked, entry.UntrackedSha)
	}
	if entry.FileCount != 1 {
		t.Fatalf("entry.FileCount = %d, want 1 (tracked file only, probe 12)", entry.FileCount)
	}

	// --- show: both the tracked edit and the untracked add. ---
	showResp := stashRequestOK(t, client, "stash.show", gitrpc.StashShowParams{RepoID: repoID, SHA: entry.Sha})
	show := unmarshalResult[gitsession.StashShowResult](t, showResp.Result)
	if len(show.Changes) != 2 {
		t.Fatalf("stash.show changes = %+v, want 2 (a.txt modified, u.txt added)", show.Changes)
	}
	var sawModified, sawAdded bool
	for _, c := range show.Changes {
		if c.Path == "a.txt" && c.Kind == porcelain.FileModified {
			sawModified = true
		}
		if c.Path == "u.txt" && c.Kind == porcelain.FileAdded {
			sawAdded = true
		}
	}
	if !sawModified || !sawAdded {
		t.Fatalf("stash.show changes = %+v, missing expected rows", show.Changes)
	}

	// --- preflight.stashPop: nothing else has changed since the push, so this predicts clean. ---
	popPreflightResp := stashRequestOK(t, client, "preflight.stashPop", gitrpc.PreflightStashPopParams{RepoID: repoID, SHA: entry.Sha, Index: entry.Index})
	popPreflight := unmarshalResult[gitpreflight.StashPopPreflight](t, popPreflightResp.Result)
	if popPreflight.Verdict != "clean" || len(popPreflight.Blockers) != 0 {
		t.Fatalf("preflight.stashPop = %+v, want clean with no blockers", popPreflight)
	}

	// --- apply: keeps the stash, restores both changes. ---
	applyResult := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashApply", Sha: entry.Sha, RestoreIndex: false})
	if !applyResult.OK {
		t.Fatalf("stashApply failed: %+v", applyResult)
	}
	if entries := stashListOK(t, client, repoID); len(entries) != 1 {
		t.Fatalf("stash.list after apply = %+v, want still 1 (apply never drops)", entries)
	}
	stashRunGit(t, dir, "checkout", "-q", "--", "a.txt")
	if err := os.Remove(filepath.Join(dir, "u.txt")); err != nil {
		t.Fatalf("remove u.txt: %v", err)
	}

	// --- pop: removes the stash, restores both changes. ---
	popResult := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashPop", Sha: entry.Sha, Index: entry.Index, RestoreIndex: false})
	if !popResult.OK {
		t.Fatalf("stashPop failed: %+v", popResult)
	}
	if entries := stashListOK(t, client, repoID); len(entries) != 0 {
		t.Fatalf("stash.list after pop = %+v, want empty", entries)
	}
	stashRunGit(t, dir, "checkout", "-q", "--", "a.txt")
	if err := os.Remove(filepath.Join(dir, "u.txt")); err != nil {
		t.Fatalf("remove u.txt: %v", err)
	}

	// --- push again, then branch: preflight.stashBranch, then op.run — also removes the stash. ---
	stashWriteFile(t, dir, "a.txt", "line1\nmodified again\nline3\n")
	push2 := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashPush", Paths: []string{}})
	if !push2.OK {
		t.Fatalf("second stashPush failed: %+v", push2)
	}
	entry2 := stashListOK(t, client, repoID)[0]

	branchPreflightResp := stashRequestOK(t, client, "preflight.stashBranch", gitrpc.PreflightStashBranchParams{RepoID: repoID, SHA: entry2.Sha, Branch: "recovered"})
	branchPreflight := unmarshalResult[gitpreflight.StashBranchPreflight](t, branchPreflightResp.Result)
	if branchPreflight.Verdict != "clean" {
		t.Fatalf("preflight.stashBranch = %+v, want clean", branchPreflight)
	}

	branchResult := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashBranch", Branch: "recovered", Sha: entry2.Sha, Index: entry2.Index})
	if !branchResult.OK {
		t.Fatalf("stashBranch failed: %+v", branchResult)
	}
	if entries := stashListOK(t, client, repoID); len(entries) != 0 {
		t.Fatalf("stash.list after stash branch = %+v, want empty (real `stash branch` drops it)", entries)
	}
	refsResp := stashRequestOK(t, client, "refs.list", gitrpc.RefsListParams{RepoID: repoID})
	refs := unmarshalResult[gitsession.RefsResult](t, refsResp.Result)
	var sawRecovered bool
	for _, b := range refs.Branches {
		if b.ShortName == "recovered" {
			sawRecovered = true
		}
	}
	if !sawRecovered {
		t.Fatalf("refs.list branches = %+v, want \"recovered\" among them", refs.Branches)
	}

	// --- back to main, push a third time, then drop: undoable (G17's own addition), and the undo
	// slot restores it. ---
	stashRunGit(t, dir, "checkout", "-q", "main")
	stashWriteFile(t, dir, "a.txt", "line1\nyet another change\nline3\n")
	push3 := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashPush", Paths: []string{}})
	if !push3.OK {
		t.Fatalf("third stashPush failed: %+v", push3)
	}
	entry3 := stashListOK(t, client, repoID)[0]

	dropResult := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashDrop", Sha: entry3.Sha, Index: entry3.Index})
	if !dropResult.OK {
		t.Fatalf("stashDrop failed: %+v", dropResult)
	}
	if dropResult.Undo == nil {
		t.Fatal("stashDrop's own OpResult.Undo is nil, want a real undo slot (undoable, unlike its four stash siblings)")
	}
	if entries := stashListOK(t, client, repoID); len(entries) != 0 {
		t.Fatalf("stash.list after drop = %+v, want empty", entries)
	}

	undoResp := stashRequestOK(t, client, "undo.run", gitrpc.UndoRunParams{RepoID: repoID, ID: dropResult.Undo.ID})
	undoResult := unmarshalResult[gitsession.OpResult](t, undoResp.Result)
	if !undoResult.OK {
		t.Fatalf("undo.run failed: %+v", undoResult)
	}
	restored := stashListOK(t, client, repoID)
	if len(restored) != 1 || restored[0].Sha != entry3.Sha {
		t.Fatalf("stash.list after undo = %+v, want the same entry (sha %s) back", restored, entry3.Sha)
	}
}

// TestIntegration_StashPopConflictOverTheWire is §7.1.6's own required case: a real conflicting
// `stash pop`, over the real socket — `{ok: false, error: {kind: "StashConflict", ...}}`, never
// "Unknown", and the stash entry still present afterward.
func TestIntegration_StashPopConflictOverTheWire(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	stashRunGit(t, dir, "init", "-q", "-b", "main")
	stashWriteFile(t, dir, "f.txt", "line1\nline2\nline3\n")
	stashRunGit(t, dir, "add", "f.txt")
	stashRunGit(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base")
	stashRunGit(t, dir, "branch", "other")

	// main: advances past base, changing the same line the stash will also touch.
	stashWriteFile(t, dir, "f.txt", "line1\nMAIN\nline3\n")
	stashRunGit(t, dir, "add", "f.txt")
	stashRunGit(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "main change")

	// other: stays at base, a dirty (uncommitted) change to the same line, then stashed.
	stashRunGit(t, dir, "checkout", "-q", "other")
	stashWriteFile(t, dir, "f.txt", "line1\nSTASH\nline3\n")
	stashRunGit(t, dir, "stash", "push", "-q", "-m", "conflict test")
	stashRunGit(t, dir, "checkout", "-q", "main")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "stash-conflict-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	before := stashListOK(t, client, repoID)
	if len(before) != 1 {
		t.Fatalf("stash.list before pop = %+v, want 1 entry", before)
	}
	entry := before[0]

	preflightResp := stashRequestOK(t, client, "preflight.stashPop", gitrpc.PreflightStashPopParams{RepoID: repoID, SHA: entry.Sha, Index: entry.Index})
	preflight := unmarshalResult[gitpreflight.StashPopPreflight](t, preflightResp.Result)
	if preflight.Verdict != "willConflict" {
		t.Fatalf("preflight.stashPop = %+v, want willConflict (both sides changed the same line)", preflight)
	}

	popResult := stashOpRunOK(t, client, repoID, gitsession.OpRequest{Kind: "stashPop", Sha: entry.Sha, Index: entry.Index, RestoreIndex: false})
	if popResult.OK {
		t.Fatalf("stashPop result.OK = true, want false (a real conflict)")
	}
	if popResult.Error == nil || popResult.Error.Kind != "StashConflict" {
		t.Fatalf("stashPop result.Error = %+v, want Kind = StashConflict, never Unknown", popResult.Error)
	}

	after := stashListOK(t, client, repoID)
	if len(after) != 1 || after[0].Sha != entry.Sha {
		t.Fatalf("stash.list after a conflicting pop = %+v, want the same entry still present", after)
	}
}
