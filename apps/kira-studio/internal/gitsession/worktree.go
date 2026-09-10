package gitsession

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitprepare"
)

// ---------------------------------------------------------------------------------------
// worktree.list (D1)
// ---------------------------------------------------------------------------------------

// WorktreeLockInfo/WorktreePrunableInfo mirror the wire's own WorktreeEntry.locked/.prunable —
// {reason: string} or null, never a bare boolean plus a separate string field (D1).
type WorktreeLockInfo struct {
	Reason string `json:"reason"`
}
type WorktreePrunableInfo struct {
	Reason string `json:"reason"`
}

// WorktreeEntry mirrors D1's own wire shape exactly — Head/Branch nil rather than "" for the
// bare/orphan/detached cases porcelain.WorktreeRecord already distinguishes.
type WorktreeEntry struct {
	Path          string                `json:"path"`
	Head          *string               `json:"head"`
	Branch        *string               `json:"branch"`
	IsBare        bool                  `json:"isBare"`
	IsDetached    bool                  `json:"isDetached"`
	IsMain        bool                  `json:"isMain"`
	IsCurrent     bool                  `json:"isCurrent"`
	Locked        *WorktreeLockInfo     `json:"locked"`
	Prunable      *WorktreePrunableInfo `json:"prunable"`
	OpenElsewhere bool                  `json:"openElsewhere"`
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// rawWorktreeList spawns WorktreeListArgs and parses it — the one spawn worktree.list, both
// pre-flights, and the remove op's own re-check all share (D1's own doc comment: "never cached").
func (e *RepoEntry) rawWorktreeList(ctx context.Context) ([]porcelain.WorktreeRecord, error) {
	raw, err := e.runOne(ctx, porcelain.WorktreeListArgs())
	if err != nil {
		return nil, err
	}
	return porcelain.ParseWorktreeList(raw)
}

func findWorktree(records []porcelain.WorktreeRecord, path string) (porcelain.WorktreeRecord, bool) {
	target := filepath.Clean(path)
	for _, r := range records {
		if filepath.Clean(r.Path) == target {
			return r, true
		}
	}
	return porcelain.WorktreeRecord{}, false
}

// Worktrees is worktree.list's own query (D1) — probe P4/P1: `worktree list`'s own first record is
// always the main worktree, so IsMain is positional, never re-derived from a separate spawn.
// OpenElsewhere is computed per entry via e.isOpen (F7/Registry.IsOpen) for every entry other than
// this one's own current worktree — never for IsCurrent (a worktree cannot be "open elsewhere"
// relative to itself).
func (e *RepoEntry) Worktrees(ctx context.Context) ([]WorktreeEntry, error) {
	records, err := e.rawWorktreeList(ctx)
	if err != nil {
		return nil, err
	}
	ownRoot := filepath.Clean(e.Summary.Root)

	out := make([]WorktreeEntry, 0, len(records))
	for i, r := range records {
		entry := WorktreeEntry{
			Path: r.Path, Head: nonEmpty(r.Head), Branch: nonEmpty(r.Branch),
			IsBare: r.Bare, IsDetached: r.Detached,
			IsMain:    i == 0,
			IsCurrent: filepath.Clean(r.Path) == ownRoot,
		}
		if r.Locked {
			entry.Locked = &WorktreeLockInfo{Reason: r.LockedReason}
		}
		if r.Prunable {
			entry.Prunable = &WorktreePrunableInfo{Reason: r.PrunableReason}
		}
		if e.isOpen != nil && !entry.IsCurrent {
			entry.OpenElsewhere = e.isOpen(r.Path)
		}
		out = append(out, entry)
	}
	return out, nil
}

// ---------------------------------------------------------------------------------------
// preflight.worktreeAdd (D4)
// ---------------------------------------------------------------------------------------

// WorktreeAddParams is preflight.worktreeAdd's own request, minus repoId (the entry's own).
type WorktreeAddParams struct {
	Path       string
	Mode       string // "existingBranch" | "newBranch" | "detach"
	Branch     string
	StartPoint string
}

// isPathInsideRepo: Path resolves (Abs, never symlink-resolved — a legal nesting question, not a
// security boundary; D4's own note, never a blocker) inside root's own working tree.
func isPathInsideRepo(path, root string) bool {
	absPath, err1 := filepath.Abs(path)
	absRoot, err2 := filepath.Abs(root)
	if err1 != nil || err2 != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != "..")
}

// WorktreeAddPreflight is preflight.worktreeAdd's own orchestration (D4/F2): no new spawn beyond
// the refs snapshot pre-flight already uses for branchCheckedOutElsewhere/branchExists (F2 — the
// SAME %(worktreepath) crossing G5 built), plus one resolveCommit re-check for the start point and
// two plain os.Stat calls for the path itself.
func (e *RepoEntry) WorktreeAddPreflight(ctx context.Context, p WorktreeAddParams) (gitpreflight.WorktreeAddPreflight, error) {
	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return gitpreflight.WorktreeAddPreflight{}, err
	}

	pathExists := false
	if _, statErr := os.Stat(p.Path); statErr == nil {
		pathExists = true
	}
	parentDirMissing := false
	if !pathExists {
		if _, statErr := os.Stat(filepath.Dir(p.Path)); statErr != nil {
			parentDirMissing = true
		}
	}

	var branchCheckedOutElsewhere *string
	branchExists := false
	if p.Mode == "existingBranch" {
		for _, r := range snapshot.Branches {
			if r.ShortName == p.Branch {
				branchCheckedOutElsewhere = r.CheckedOutIn
				break
			}
		}
	}
	if p.Mode == "newBranch" {
		for _, r := range snapshot.Branches {
			if r.ShortName == p.Branch {
				branchExists = true
				break
			}
		}
	}

	startPointRef := p.StartPoint
	if p.Mode == "existingBranch" {
		startPointRef = p.Branch
	}
	startPointResolves := false
	if startPointRef != "" {
		resolved, rerr := e.resolveCommit(ctx, startPointRef)
		if rerr != nil {
			return gitpreflight.WorktreeAddPreflight{}, rerr
		}
		startPointResolves = resolved != nil
	}

	return gitpreflight.ClassifyWorktreeAdd(gitpreflight.ClassifyWorktreeAddInput{
		Path: p.Path, Mode: p.Mode, Branch: p.Branch, StartPoint: p.StartPoint,
		PathExists: pathExists, PathInsideRepo: isPathInsideRepo(p.Path, e.Summary.Root), ParentDirMissing: parentDirMissing,
		BranchCheckedOutElsewhere: branchCheckedOutElsewhere, BranchExists: branchExists,
		StartPointResolves: startPointResolves,
	}), nil
}

// ---------------------------------------------------------------------------------------
// preflight.worktreeRemove (D8)
// ---------------------------------------------------------------------------------------

// runOneInDir runs a READ-ONLY spawn against an arbitrary directory — not necessarily this
// entry's own root — through this SAME entry's own read gate (e.Repo.Read): worktree remove's own
// dirty check targets a DIFFERENT worktree's own working tree, but every worktree under one
// `.git` shares the same object/ref store, so serializing it alongside this entry's other reads is
// the correct concurrency discipline, not merely a convenient one.
func (e *RepoEntry) runOneInDir(ctx context.Context, dir string, args []string) ([]byte, error) {
	var out []byte
	err := e.Repo.Read(ctx, func(ctx context.Context) error {
		res, rerr := gitclient.Run(ctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
			Dir: dir, Args: args, ReadOnly: true,
		})
		if cerr := gitclient.Classify(ctx, args, res, rerr); cerr != nil {
			return cerr
		}
		out = res.Stdout
		return nil
	})
	return out, err
}

// worktreeIsDirty runs `status --porcelain=v2 -z` IN dir (the target worktree, not necessarily
// this entry's own) — DirtyPaths already counts untracked files (probe M4's own "modified or
// untracked files" message is exactly this union).
func (e *RepoEntry) worktreeIsDirty(ctx context.Context, dir string) (bool, error) {
	raw, err := e.runOneInDir(ctx, dir, porcelain.StatusArgs())
	if err != nil {
		return false, err
	}
	recs, err := allRecords(raw)
	if err != nil {
		return false, err
	}
	statusResult, err := porcelain.ParseStatus(recs)
	if err != nil {
		return false, err
	}
	return len(gitpreflight.DirtyPaths(statusResult)) > 0, nil
}

// WorktreeRemovePreflight is preflight.worktreeRemove's own orchestration (D8/F7/F8): notAWorktree
// is checked first and, when true, short-circuits every other read (the security gate — there is
// nothing left worth computing about a path that is not a real worktree). The dirty check is
// skipped whenever any of the four other blockers already applies — one fewer spawn, and
// irrelevant anyway since ClassifyWorktreeRemove's own verdict is "blocked" regardless of Dirty
// once any blocker is present.
func (e *RepoEntry) WorktreeRemovePreflight(ctx context.Context, path string) (gitpreflight.WorktreeRemovePreflight, error) {
	records, err := e.rawWorktreeList(ctx)
	if err != nil {
		return gitpreflight.WorktreeRemovePreflight{}, err
	}

	target, isWorktree := findWorktree(records, path)
	in := gitpreflight.ClassifyWorktreeRemoveInput{Path: path, IsWorktree: isWorktree}
	if !isWorktree {
		return gitpreflight.ClassifyWorktreeRemove(in), nil
	}

	if len(records) > 0 {
		in.IsMainWorktree = filepath.Clean(target.Path) == filepath.Clean(records[0].Path)
	}
	in.IsCurrentWorktree = filepath.Clean(target.Path) == filepath.Clean(e.Summary.Root)
	if e.isOpen != nil {
		in.OpenInAnotherWindow = e.isOpen(target.Path)
	}
	if target.Locked {
		reason := target.LockedReason
		in.LockedReason = &reason
	}

	if in.IsMainWorktree || in.IsCurrentWorktree || in.OpenInAnotherWindow || in.LockedReason != nil {
		return gitpreflight.ClassifyWorktreeRemove(in), nil
	}

	dirty, err := e.worktreeIsDirty(ctx, target.Path)
	if err != nil {
		return gitpreflight.WorktreeRemovePreflight{}, err
	}
	in.Dirty = dirty
	return gitpreflight.ClassifyWorktreeRemove(in), nil
}

// ---------------------------------------------------------------------------------------
// opTable's two new kinds (D2) — worktreeAdd/worktreeRemove
// ---------------------------------------------------------------------------------------

// worktreeAddBlockedError maps ClassifyWorktreeAdd's own five blocker kinds onto EXISTING
// OpErrorKind values (D16: this phase adds exactly one new kind to the whole contract, WorktreeLocked,
// spent entirely on the remove side) — a defensive re-check server-side; the dialog's own Create
// button is disabled by the SAME preflight before this is ever reachable in ordinary use.
func worktreeAddBlockedError(pf gitpreflight.WorktreeAddPreflight) *OpError {
	if len(pf.Blockers) == 0 {
		return &OpError{Kind: "Unknown", Message: "This worktree cannot be created."}
	}
	b := pf.Blockers[0]
	switch b.Kind {
	case "pathExists":
		return &OpError{Kind: "AlreadyExists", Message: fmt.Sprintf("%s already exists.", b.Path)}
	case "branchExists":
		return &OpError{Kind: "AlreadyExists", Message: fmt.Sprintf("A branch named %q already exists.", b.Branch)}
	case "branchCheckedOutElsewhere":
		return &OpError{Kind: "WorktreeConflict", Message: fmt.Sprintf("%q is already checked out at %s.", b.Branch, b.WorktreePath)}
	case "unknownStartPoint":
		return &OpError{Kind: "NotFound", Message: fmt.Sprintf("%s does not resolve to a commit.", b.StartPoint)}
	default: // invalidPath
		return &OpError{Kind: "Unknown", Message: "The worktree path is invalid."}
	}
}

// prepareWorktreeAdd is worktreeAdd's own opSpec.Prepare (D2/D3): re-runs the SAME preflight
// classification host-side immediately before the write (never trusting a client-side preflight
// that may have gone stale), then builds exactly one of D3's three explicit-commit-ish argv
// variants — bare DWIM is never reachable from this path.
func prepareWorktreeAdd(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	pf, err := e.WorktreeAddPreflight(ctx, WorktreeAddParams{
		Path: op.Path, Mode: op.Mode, Branch: op.Branch, StartPoint: op.StartPoint,
	})
	if err != nil {
		return prepared{}, err
	}
	if pf.Verdict == "blocked" {
		return prepared{earlyError: worktreeAddBlockedError(pf)}, nil
	}

	var argv []string
	switch op.Mode {
	case "existingBranch":
		argv = gitops.WorktreeAddExistingBranchArgs(op.Path, op.Branch)
	case "newBranch":
		argv = gitops.WorktreeAddNewBranchArgs(op.Path, op.Branch, op.StartPoint)
	case "detach":
		argv = gitops.WorktreeAddDetachArgs(op.Path, op.StartPoint)
	default:
		return prepared{earlyError: &OpError{Kind: "Unknown", Message: "unrecognised worktree creation mode: " + op.Mode}}, nil
	}
	return prepared{argvList: [][]string{argv}}, nil
}

// worktreeRemoveBlockedError maps ClassifyWorktreeRemove's own five blocker kinds — "locked" is the
// one row that reuses D15's own new WorktreeLocked kind (the exact remedy git itself would name);
// every other blocker is a structural refusal the UI should never let a user reach in the first
// place (the Remove button/menu item is disabled for all four), so "Unknown" plus a plain-English
// reason is what a defensive server-side re-check answers for them.
func worktreeRemoveBlockedError(pf gitpreflight.WorktreeRemovePreflight) *OpError {
	if len(pf.Blockers) == 0 {
		return &OpError{Kind: "Unknown", Message: "This worktree cannot be removed."}
	}
	b := pf.Blockers[0]
	switch b.Kind {
	case "locked":
		return &OpError{Kind: "WorktreeLocked", Message: fmt.Sprintf("This worktree is locked (%s) — unlock it first.", b.Reason)}
	case "mainWorktree":
		return &OpError{Kind: "Unknown", Message: "The main worktree cannot be removed."}
	case "currentWorktree":
		return &OpError{Kind: "Unknown", Message: "This worktree is open in this window and cannot remove itself."}
	case "openInAnotherWindow":
		return &OpError{Kind: "Unknown", Message: "This worktree is open in another window — close it there first."}
	default: // notAWorktree
		return &OpError{Kind: "Unknown", Message: "This path is not one of this repository's worktrees."}
	}
}

// prepareWorktreeRemove is worktreeRemove's own opSpec.Prepare (D2/D8/F8): re-runs the FULL
// preflight classification immediately before the write (never trusting the client's own possibly
// stale copy), and — for the dirty route — re-derives the confirmation token FRESH from that same
// re-check and compares it byte for byte against what the client typed; force is decided
// server-side from the fresh verdict, never taken as the client's own claim (fail-safe over
// fail-open, D8's own stated principle for this destructive path).
func prepareWorktreeRemove(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	pf, err := e.WorktreeRemovePreflight(ctx, op.Path)
	if err != nil {
		return prepared{}, err
	}
	if pf.Verdict == "blocked" {
		return prepared{earlyError: worktreeRemoveBlockedError(pf)}, nil
	}

	force := false
	if pf.Verdict == "dirty" {
		if op.ConfirmToken == nil || *op.ConfirmToken != pf.ConfirmToken {
			return prepared{earlyError: &OpError{
				Kind:    "ConfirmationRequired",
				Message: fmt.Sprintf("Type %q to confirm — this worktree has uncommitted changes that will be lost.", pf.ConfirmToken),
			}}, nil
		}
		force = true
	}
	return prepared{argvList: [][]string{gitops.WorktreeRemoveArgs(op.Path, force)}}, nil
}

// ---------------------------------------------------------------------------------------
// worktree.prepare / worktree.cancelPrepare (D9-D14)
// ---------------------------------------------------------------------------------------

// prepareOpSlot is D13's own "≤1 prepare run per repository" box — simpler than remoteOpSlot
// (remote.go): a prepare run is ALWAYS cancellable (D12), so there is no killable toggle to track.
type prepareOpSlot struct {
	mu     sync.Mutex
	active bool
	cancel context.CancelFunc
}

func (s *prepareOpSlot) claim(cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		return false
	}
	s.active = true
	s.cancel = cancel
	return true
}

func (s *prepareOpSlot) release() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active, s.cancel = false, nil
}

func (s *prepareOpSlot) tryCancel() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.active {
		return false
	}
	s.cancel()
	return true
}

func (s *prepareOpSlot) forceCancel() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
}

// WorktreePrepareLine mirrors one gitprepare.Line at the wire (D13) — gitprepare itself carries no
// json tags (D18: it knows nothing about the wire), so this is the one place a Line is dressed for
// transport.
type WorktreePrepareLine struct {
	Stream string `json:"stream"`
	Text   string `json:"text"`
}

func wireLines(lines []gitprepare.Line) []WorktreePrepareLine {
	out := make([]WorktreePrepareLine, len(lines))
	for i, l := range lines {
		out[i] = WorktreePrepareLine{Stream: l.Stream, Text: l.Text}
	}
	return out
}

// WorktreeProgress mirrors worktree.progress's own event payload.
type WorktreeProgress struct {
	RepoID string                `json:"repoId"`
	Lines  []WorktreePrepareLine `json:"lines"`
}

// WorktreePrepareResult mirrors worktree.prepare's own wire result.
type WorktreePrepareResult struct {
	OK        bool                  `json:"ok"`
	Error     *OpError              `json:"error,omitempty"`
	ExitCode  int                   `json:"exitCode"`
	TimedOut  bool                  `json:"timedOut"`
	Cancelled bool                  `json:"cancelled"`
	Output    []WorktreePrepareLine `json:"output"`
	Truncated bool                  `json:"truncated"`
}

// CancelPrepare is worktree.cancelPrepare's own executor (D13) — false, never an error, when
// nothing is running (a cancel racing a just-finished run is ordinary, not a fault).
func (e *RepoEntry) CancelPrepare() bool {
	return e.prepare.tryCancel()
}

func noSpawnPrepareResult(kind, message string) (WorktreePrepareResult, error) {
	return WorktreePrepareResult{OK: false, Error: &OpError{Kind: kind, Message: message}, Output: []WorktreePrepareLine{}}, nil
}

// RunPrepare is worktree.prepare's own executor, in EXACTLY D13's stated order:
//  1. claim the ≤1 prepare slot (else AlreadyRunning, no spawn).
//  2. resolve the stored script (empty ⇒ NotConfigured, no spawn).
//  3. re-hash the CURRENTLY STORED text and compare to params.ScriptSha256 (mismatch ⇒
//     ScriptChanged, no spawn) — re-checked immediately before the spawn, never trusting that the
//     script the client believes it is running still matches what is on file (a second window may
//     have edited it since the client last read it). The human-confirmation gate itself — did
//     someone actually look at this text before clicking Run — lives entirely client-side, in the
//     extension's own confirmation dialog; this check is a staleness guard, not that gate.
//  4. verify path is a real worktree of THIS repository (⇒ NotAWorktree, no spawn) — the same
//     security property D8's notAWorktree blocker states for remove, restated here for prepare.
//  5. resolve the shell (D9/D16), build the env (D12/F12) from the worktree's own facts, and spawn
//     OUTSIDE Repo.Read/Repo.Write entirely (F3) — streaming sanitized batches as worktree.progress.
//  6. release the slot (deferred) and return.
//
// deps.Runner defaults to a real gitprepare.OSRunner in production (gitrpc wires it); every
// gitsession test fakes it, so no test in this package ever spawns a real shell (D18).
type WorktreePrepareDeps struct {
	Runner gitprepare.Runner
	Getenv func(string) string
}

func (e *RepoEntry) RunPrepare(ctx context.Context, conn *Conn, path, scriptSha256 string, deps WorktreePrepareDeps) (WorktreePrepareResult, error) {
	opCtx, cancel := context.WithCancel(ctx)
	if !e.prepare.claim(cancel) {
		cancel()
		return noSpawnPrepareResult("AlreadyRunning", "A prepare script is already running for this repository.")
	}
	defer func() {
		e.prepare.release()
		cancel()
	}()

	settings := e.RepoSettings()
	script := settings.WorktreePrepareScript
	if script == "" {
		return noSpawnPrepareResult("NotConfigured", "No prepare script is configured for this repository.")
	}

	sum := sha256.Sum256([]byte(script))
	currentSha := hex.EncodeToString(sum[:])
	if currentSha != scriptSha256 {
		return noSpawnPrepareResult("ScriptChanged", "The prepare script has changed since it was last shown — review it again before running.")
	}

	records, err := e.rawWorktreeList(ctx)
	if err != nil {
		return WorktreePrepareResult{}, err
	}
	target, isWorktree := findWorktree(records, path)
	if !isWorktree {
		return noSpawnPrepareResult("NotAWorktree", "This path is not one of this repository's worktrees.")
	}

	getenv := deps.Getenv
	if getenv == nil {
		getenv = os.Getenv
	}
	shell, loginShell := gitprepare.ResolveShell(getenv, gitprepare.IsExecutableFile)

	branch := ""
	if target.Branch != "" {
		branch = strings.TrimPrefix(target.Branch, "refs/heads/")
	}
	env := gitprepare.BuildEnv(os.Environ(), gitprepare.Vars{
		WorktreePath: target.Path, WorktreeBranch: branch,
		RepoRoot: e.Summary.Root, RepoCommonDir: e.Summary.CommonDir,
	})

	runner := deps.Runner
	if runner == nil {
		runner = gitprepare.NewOSRunner()
	}

	onBatch := func(lines []gitprepare.Line) {
		if conn == nil || conn.Emit == nil {
			return
		}
		conn.Emit("worktree.progress", WorktreeProgress{RepoID: e.Summary.RepoID, Lines: wireLines(lines)})
	}

	res, err := runner.Run(opCtx, gitprepare.Spec{
		Shell: shell, LoginShell: loginShell, Script: script, Dir: target.Path, Env: env, OnBatch: onBatch,
	})
	if err != nil {
		return WorktreePrepareResult{}, err
	}

	result := WorktreePrepareResult{
		OK:       !res.TimedOut && !res.Cancelled && res.ExitCode == 0,
		ExitCode: res.ExitCode, TimedOut: res.TimedOut, Cancelled: res.Cancelled,
		Output: wireLines(res.Output), Truncated: res.Truncated,
	}
	switch {
	case res.Cancelled:
		result.Error = &OpError{Kind: "Cancelled", Message: "the prepare script was cancelled"}
	case res.TimedOut:
		result.Error = &OpError{Kind: "Unknown", Message: fmt.Sprintf("the prepare script did not finish within %s and was stopped", gitprepare.PrepareTimeout)}
	case res.ExitCode != 0:
		result.Error = &OpError{Kind: "Unknown", Message: fmt.Sprintf("the prepare script exited with status %d", res.ExitCode)}
	}
	return result, nil
}
