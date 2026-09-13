package gitsession

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// remoteOpSlot is SPEC §6's own "active remote op (≤1)" box — shared across every connection open
// on this repository (D9/D11/D20): a second remote.run on the same repository, from any
// connection, is refused rather than queued (upstream's own OQ7 — a push sitting invisibly behind
// a ninety-second fetch is worse than being told to wait, and it makes "which op does cancel
// cancel?" ambiguous).
type remoteOpSlot struct {
	mu       sync.Mutex
	kind     string // "" when idle
	killable bool   // flips per phase (D19)
	cancel   context.CancelFunc
}

func (s *remoteOpSlot) claim(kind string, cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kind != "" {
		return false
	}
	s.kind, s.killable, s.cancel = kind, false, cancel
	return true
}

func (s *remoteOpSlot) setKillable(v bool) {
	s.mu.Lock()
	s.killable = v
	s.mu.Unlock()
}

func (s *remoteOpSlot) release() {
	s.mu.Lock()
	s.kind, s.killable, s.cancel = "", false, nil
	s.mu.Unlock()
}

// tryCancel is remote.cancel's own executor (D19): false — NEVER an error — when nothing is
// running or the current phase is not killable; a cancel racing a just-finished op is an ordinary
// outcome, not a fault.
func (s *remoteOpSlot) tryCancel() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kind == "" || !s.killable {
		return false
	}
	s.cancel()
	return true
}

// forceCancel is teardown's own unconditional cancel — the entry itself is going away, so any
// in-flight op's context is cancelled regardless of its killable flag.
func (s *remoteOpSlot) forceCancel() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
}

// CancelRemote is remote.cancel's own entry point.
func (e *RepoEntry) CancelRemote() bool {
	return e.remoteOp.tryCancel()
}

// RemoteOpParams is remote.run's own operation fields — gitrpc's own wire type embeds this
// alongside RepoID (the same "gitsession owns the flattened decode" precedent OpRequest already
// established for op.run, D5), since remote.run's own wire params are flat (no nested object).
type RemoteOpParams struct {
	Kind              string  `json:"kind"` // "fetch" | "push" | "pull" | "forcePush" | "deleteRemoteBranch"
	Remote            string  `json:"remote"`
	Branch            string  `json:"branch,omitempty"`
	SetUpstream       bool    `json:"setUpstream,omitempty"`
	Prune             bool    `json:"prune,omitempty"`
	PruneTags         bool    `json:"pruneTags,omitempty"`
	Strategy          string  `json:"strategy,omitempty"`
	ExpectedRemoteTip *string `json:"expectedRemoteTip,omitempty"`
	PlainForce        bool    `json:"plainForce,omitempty"`
	ConfirmToken      string  `json:"confirmToken,omitempty"`
}

// RemoteOpError mirrors @kira/git-ipc's own remote.run error shape.
type RemoteOpError struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	// RemoteMessage is set only for a HookRejected (D14) — the hook's own remote:-prefixed output,
	// prefix stripped and right-trimmed.
	RemoteMessage *string `json:"remoteMessage,omitempty"`
}

// RemoteOpResult mirrors @kira/git-ipc's own RemoteOpResult field for field (D5's encoding rule).
type RemoteOpResult struct {
	OK         bool                              `json:"ok"`
	Error      *RemoteOpError                    `json:"error,omitempty"`
	Updates    []gitops.RefUpdate                `json:"updates"`
	Head       gitclient.HeadState               `json:"head"`
	InProgress *gitpreflight.InProgressOperation `json:"inProgress"`
}

// RemoteProgress mirrors @kira/git-ipc's own RemoteProgress field for field — RepoID is added
// here, never carried on gitops.Progress itself (a fact about the wire, not about the parser).
type RemoteProgress struct {
	RepoID  string `json:"repoId"`
	Phase   string `json:"phase"`
	Percent *int   `json:"percent,omitempty"`
	Done    *int   `json:"done,omitempty"`
	Total   *int   `json:"total,omitempty"`
	Remote  bool   `json:"remote"`
}

// RemoteDeps is everything RunRemote needs beyond the entry's own state and conn — the askpass
// broker, nil when it failed to start (D10's own already-supported "no interposition" path, not a
// new failure mode).
type RemoteDeps struct {
	Askpass *gitaskpass.Broker
}

// repoPrompter adapts gitaskpass.Prompter onto one Conn — the one piece of glue this package needs
// beyond Conn.AskCredential itself, since the broker has no notion of a repository (D21):
// gitsession imports gitaskpass (a stdlib-only leaf package) rather than the reverse.
type repoPrompter struct {
	repoID string
	conn   *Conn
}

func (p repoPrompter) Ask(ctx context.Context, req gitaskpass.Request) (string, bool) {
	req.RepoID = p.repoID
	return p.conn.AskCredential(ctx, req)
}

// coreAskPass is D10's own per-entry, lazy, once-per-RepoEntry read of `core.askPass` — cached for
// the entry's whole life alongside its other caches (entry.go's own pattern).
func (e *RepoEntry) coreAskPass(ctx context.Context) string {
	e.askPassMu.Lock()
	defer e.askPassMu.Unlock()
	if e.askPassChecked {
		return e.askPassValue
	}
	res, err := e.runAllowingExit(ctx, gitops.CoreAskPassArgs(), 0, 1)
	if err == nil && res.ExitCode == 0 {
		e.askPassValue = strings.TrimSpace(string(res.Stdout))
	}
	e.askPassChecked = true
	return e.askPassValue
}

// withAskpass runs fn with the env D8's shim needs, or with none at all (D10) when a user's own
// core.askPass or an inherited GIT_ASKPASS should win instead, or when there is no broker, or no
// connection to relay a prompt to at all (auto-fetch's own ctx: it never prompts, D23, structurally
// rather than by policy — conn is simply nil).
func (e *RepoEntry) withAskpass(ctx context.Context, conn *Conn, deps RemoteDeps, fn func(env []string) error) error {
	if deps.Askpass == nil || conn == nil || !deps.Askpass.ShouldInterpose(e.coreAskPass(ctx)) {
		return fn(nil)
	}
	prompter := repoPrompter{repoID: e.Summary.RepoID, conn: conn}
	return deps.Askpass.WithOp(ctx, prompter, func(opEnv []string) error {
		env := make([]string, 0, len(opEnv)+5)
		env = append(env, deps.Askpass.Env()...)
		env = append(env, opEnv...)
		return fn(env)
	})
}

// runRemoteSpawn runs one remote-op argv OUTSIDE the repo's read/write gate (D11): a fetch or a
// push writes objects and remote-tracking refs under git's own locking, takes no index lock and
// touches no worktree file, so it is exactly as safe alongside a concurrent read (or a concurrent
// checkout) as it is from a terminal — the shared slot above is the only serialization a remote op
// needs against ANOTHER remote op. Setsid (D6, opted in here and nowhere else in this chapter's
// already-shipped code) keeps the child off any controlling terminal.
func (e *RepoEntry) runRemoteSpawn(ctx context.Context, argv, env []string, onStderr func([]byte)) (gitclient.Result, error) {
	return gitclient.Run(ctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
		Dir: repoWorkingDir(e.Summary), Args: argv, Env: env, OnStderr: onStderr, Setsid: true,
	})
}

func sPtr(s string) *string { return &s }

// readRemoteTip resolves refs/remotes/<remote>/<branch>, or nil when it does not exist (F15).
func (e *RepoEntry) readRemoteTip(ctx context.Context, remote, branch string) (*string, error) {
	res, err := e.runAllowingExit(ctx, gitops.RemoteTipArgs(remote, branch), 0, 1)
	if err != nil {
		return nil, err
	}
	if res.ExitCode != 0 {
		return nil, nil
	}
	tip := strings.TrimSpace(string(res.Stdout))
	return &tip, nil
}

func remoteTipsEqual(current, expected *string) bool {
	if current == nil || expected == nil {
		return current == nil && expected == nil
	}
	return *current == *expected
}

// resolveUpstreamRemoteBranch is fetch/pull/push's own shared upstream lookup (G32 round-3
// functional-correctness review, finding #1/#3): a branch's already-configured upstream can name
// ANY branch on the remote, not just one sharing the local branch's own name (`git checkout -b
// feat origin/main`, or any fork workflow, produces exactly this) — %(upstream) (the SAME
// for-each-ref field `PullPreflight` already trusts, D10's own precedent) is the one source of
// truth for "where does this branch's history already live on <remote>," never a same-name guess.
// Returns the remote-side branch name to fetch from / push to, and whether an upstream configured
// for THIS remote specifically was found. When it wasn't (no upstream at all, a purely local
// upstream, or an upstream on a different remote than the one this call is about), `branch` itself
// is returned unchanged — the pre-existing same-name behavior for every case outside this bug's
// actual scope (a branch that has genuinely never been pushed still gets the same "try the
// same-named ref, fail with a real git error if it's not there" behavior it always has).
func (e *RepoEntry) resolveUpstreamRemoteBranch(ctx context.Context, remote, branch string) (remoteBranch string, hasUpstream bool, err error) {
	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return "", false, err
	}
	const remotePrefix = "refs/remotes/"
	for _, r := range snapshot.Branches {
		if r.ShortName != branch || r.Upstream == nil {
			continue
		}
		ref := *r.Upstream
		if !strings.HasPrefix(ref, remotePrefix) {
			break // a purely local upstream (refs/heads/<other>) is not a fetch/push target
		}
		rest := strings.TrimPrefix(ref, remotePrefix)
		idx := strings.IndexByte(rest, '/')
		if idx < 0 {
			break
		}
		if upstreamRemote := rest[:idx]; upstreamRemote == remote {
			return rest[idx+1:], true, nil
		}
		break
	}
	return branch, false, nil
}

// refSnapshot is D13's own narrow ref->sha map (porcelain.RefSnapshotArgs, through Repo.Read) —
// deliberately distinct from refs.go's refsSnapshot, which builds the structured, cached RefsResult
// wire type: this one exists only to be diffed before/after a fetch.
func (e *RepoEntry) refSnapshot(ctx context.Context) (map[string]string, error) {
	raw, err := e.runOne(ctx, porcelain.RefSnapshotArgs())
	if err != nil {
		return nil, err
	}
	return porcelain.ParseRefSnapshot(raw)
}

// diffRefSnapshots is D13's own fetch/pull RefUpdate[] derivation: present-after-only is a created
// ref (from: nil); present-before-only is a deleted one (to: nil); changed is both, with `forced`
// resolved by one merge-base --is-ancestor per changed ref that has both endpoints — a set that is
// empty or tiny in every realistic fetch, and exactly empty for a first clone-shaped one where
// every ref is new.
func (e *RepoEntry) diffRefSnapshots(ctx context.Context, before, after map[string]string) ([]gitops.RefUpdate, error) {
	updates := []gitops.RefUpdate{}
	for ref, afterSha := range after {
		beforeSha, existedBefore := before[ref]
		if !existedBefore {
			updates = append(updates, gitops.RefUpdate{Ref: ref, From: nil, To: sPtr(afterSha)})
			continue
		}
		if beforeSha == afterSha {
			continue
		}
		forced, err := e.wasForced(ctx, beforeSha, afterSha)
		if err != nil {
			return nil, err
		}
		updates = append(updates, gitops.RefUpdate{Ref: ref, From: sPtr(beforeSha), To: sPtr(afterSha), Forced: forced})
	}
	for ref, beforeSha := range before {
		if _, stillExists := after[ref]; !stillExists {
			updates = append(updates, gitops.RefUpdate{Ref: ref, From: sPtr(beforeSha), To: nil})
		}
	}
	return updates, nil
}

// wasForced runs `merge-base --is-ancestor <before> <after>` (D13): exit 0 -> before is an
// ancestor of after (a fast-forward, not forced); exit 1 -> forced.
func (e *RepoEntry) wasForced(ctx context.Context, before, after string) (bool, error) {
	res, err := e.runAllowingExit(ctx, gitops.IsAncestorArgs(before, after), 0, 1)
	if err != nil {
		return false, err
	}
	return res.ExitCode != 0, nil
}

func nonNilUpdates(u []gitops.RefUpdate) []gitops.RefUpdate {
	if u == nil {
		return []gitops.RefUpdate{}
	}
	return u
}

// remoteResultNoSpawn answers a refusal that never reaches a write at all (step 1/2/3's own early
// returns, D11) — still reads back head/in-progress (G5's own rule, applied again: always, success
// or failure), so the UI's banner can never go stale because of a refused op.
func (e *RepoEntry) remoteResultNoSpawn(ctx context.Context, opErr *RemoteOpError) (RemoteOpResult, error) {
	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return RemoteOpResult{}, serr
	}
	head, herr := e.Head(ctx)
	if herr != nil {
		return RemoteOpResult{}, herr
	}
	return RemoteOpResult{OK: false, Error: opErr, Updates: []gitops.RefUpdate{}, Head: head, InProgress: inProgress}, nil
}

// RunRemote is remote.run's own executor (D11/D13/D18/D19/D20), in this exact order:
//
//  0. ctx is already detached from the request by gitrpc (D19/G5 D8) — wrapped here in the
//     entry's own WithCancel, which is what remote.cancel and teardown's forceCancel act on.
//  1. claim the shared slot; already claimed -> {ok:false, OperationInProgress} with NO write.
//  2. protected-branch re-check for forcePush/deleteRemoteBranch (D17) -> {ok:false, ProtectedBranch}.
//  3. forcePush only: re-read the remote tip and compare with expectedRemoteTip (D12)
//     -> {ok:false, LeaseViolation} BEFORE any push spawns.
//  4. askpass: interpose or not (D10), never for a nil conn (D23).
//     5/6/7: per-kind spawn, below — fetch/push family/pull.
//  8. read back head + in-progress, ALWAYS — success, failure or cancellation.
//  9. release the slot (deferred, so it holds across every early return) and return.
func (e *RepoEntry) RunRemote(ctx context.Context, conn *Conn, params RemoteOpParams, deps RemoteDeps) (RemoteOpResult, error) {
	opCtx, cancel := context.WithCancel(ctx)
	if !e.remoteOp.claim(params.Kind, cancel) {
		cancel()
		return e.remoteResultNoSpawn(ctx, &RemoteOpError{
			Kind: "OperationInProgress", Message: "another remote operation is already running on this repository",
		})
	}
	defer func() {
		e.remoteOp.release()
		cancel()
	}()

	protectedBranches, _, _ := e.settings()

	if params.Kind == "forcePush" || params.Kind == "deleteRemoteBranch" {
		if match := gitpreflight.MatchProtectedBranch(params.Branch, protectedBranches); match != nil && params.ConfirmToken != params.Branch {
			return e.remoteResultNoSpawn(ctx, &RemoteOpError{
				Kind:    "ProtectedBranch",
				Message: fmt.Sprintf("%s is protected by %q — type the branch name to confirm", params.Branch, match.Pattern),
			})
		}
	}

	if params.Kind == "forcePush" {
		// G32 round-3 finding #3's own shape: the lease re-check must compare against the SAME
		// remote-side ref PushPreflight quoted expectedRemoteTip from, or a differently-named
		// upstream makes both sides consistently (and wrongly) nil — passing the lease check
		// trivially right before the push spawns against the wrong destination anyway.
		remoteBranch, _, uerr := e.resolveUpstreamRemoteBranch(ctx, params.Remote, params.Branch)
		if uerr != nil {
			return RemoteOpResult{}, uerr
		}
		currentTip, err := e.readRemoteTip(ctx, params.Remote, remoteBranch)
		if err != nil {
			return RemoteOpResult{}, err
		}
		if !remoteTipsEqual(currentTip, params.ExpectedRemoteTip) {
			return e.remoteResultNoSpawn(ctx, &RemoteOpError{
				Kind: "LeaseViolation", Message: "the remote branch moved since this push was reviewed",
			})
		}
	}

	// D7: from here on every remaining path spawns at least one real git process that can touch
	// refs (fetch/push/pull all can) — drop the shared caches synchronously on every exit below,
	// success, a classified failure or a genuine spawn error alike, rather than waiting for the
	// watcher's own debounced signal to notice our own write.
	defer e.invalidateAfterWrite()

	progressEmit := func(p gitops.Progress) {
		if conn == nil || conn.Emit == nil {
			return
		}
		conn.Emit("remote.progress", RemoteProgress{
			RepoID: e.Summary.RepoID, Phase: p.Phase, Percent: p.Percent, Done: p.Done, Total: p.Total, Remote: p.Remote,
		})
	}
	parser := gitops.NewProgressParser(gitops.Throttle(progressEmit, 100*time.Millisecond, time.Now))
	onStderr := func(chunk []byte) { parser.Write(chunk) }

	// ctx (never cancelled by remote.cancel — only opCtx, the spawn's own context, is) is what
	// every "must still happen even after a cancellation" read below uses: the ref-snapshot reads
	// bracketing a fetch, and the final read-back after this switch. Only the actual git spawn
	// inside each helper takes opCtx.
	var updates []gitops.RefUpdate
	var opErr *RemoteOpError
	var spawnErr error

	switch params.Kind {
	case "fetch":
		e.remoteOp.setKillable(true)
		updates, opErr, spawnErr = e.runFetch(ctx, opCtx, conn, deps, params, onStderr)
	case "push", "forcePush", "deleteRemoteBranch":
		updates, opErr, spawnErr = e.runPushFamily(opCtx, conn, deps, params, onStderr)
	case "pull":
		updates, opErr, spawnErr = e.runPullOp(ctx, opCtx, conn, deps, params, onStderr)
	default:
		return RemoteOpResult{}, fmt.Errorf("gitsession: remote.run: unrecognised kind %q", params.Kind)
	}
	if spawnErr != nil {
		return RemoteOpResult{}, spawnErr
	}

	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return RemoteOpResult{}, serr
	}
	head, herr := e.Head(ctx)
	if herr != nil {
		return RemoteOpResult{}, herr
	}

	return RemoteOpResult{OK: opErr == nil, Error: opErr, Updates: nonNilUpdates(updates), Head: head, InProgress: inProgress}, nil
}

// runFetch executes a plain fetch — killable (D19), no gate (D11). roCtx (never cancelled by
// remote.cancel) is used for the ref-snapshot reads bracketing the spawn, so "whatever updates had
// already landed" can still be reported even when spawnCtx was cancelled mid-flight; only the
// actual git spawn takes spawnCtx.
func (e *RepoEntry) runFetch(roCtx, spawnCtx context.Context, conn *Conn, deps RemoteDeps, params RemoteOpParams, onStderr func([]byte)) ([]gitops.RefUpdate, *RemoteOpError, error) {
	before, err := e.refSnapshot(roCtx)
	if err != nil {
		return nil, nil, err
	}

	argv := gitops.FetchArgs(params.Remote, params.Prune, params.PruneTags)
	var res gitclient.Result
	if err := e.withAskpass(spawnCtx, conn, deps, func(env []string) error {
		r, rerr := e.runRemoteSpawn(spawnCtx, argv, env, onStderr)
		res = r
		return rerr
	}); err != nil {
		return nil, nil, err
	}

	after, err := e.refSnapshot(roCtx)
	if err != nil {
		return nil, nil, err
	}
	updates, err := e.diffRefSnapshots(roCtx, before, after)
	if err != nil {
		return nil, nil, err
	}

	if spawnCtx.Err() != nil {
		return updates, &RemoteOpError{Kind: "Cancelled", Message: "the fetch was cancelled"}, nil
	}
	if res.ExitCode != 0 {
		kind, message := gitops.ClassifyRemoteError("", string(res.Stderr), res.ExitCode)
		return updates, &RemoteOpError{Kind: kind, Message: message}, nil
	}
	return updates, nil, nil
}

// runPushFamily executes push/forcePush/deleteRemoteBranch — --porcelain always (F10), NEVER
// killable (D19: the remote may already have accepted it, so a cancelled push has an unknowable
// outcome).
func (e *RepoEntry) runPushFamily(ctx context.Context, conn *Conn, deps RemoteDeps, params RemoteOpParams, onStderr func([]byte)) ([]gitops.RefUpdate, *RemoteOpError, error) {
	var argv []string
	switch params.Kind {
	case "push":
		remoteBranch, _, err := e.resolveUpstreamRemoteBranch(ctx, params.Remote, params.Branch)
		if err != nil {
			return nil, nil, err
		}
		argv = gitops.PushArgs(params.Remote, params.Branch, remoteBranch, params.SetUpstream)
	case "forcePush":
		remoteBranch, _, err := e.resolveUpstreamRemoteBranch(ctx, params.Remote, params.Branch)
		if err != nil {
			return nil, nil, err
		}
		argv = gitops.ForcePushArgs(params.Remote, params.Branch, remoteBranch, params.PlainForce)
	default: // "deleteRemoteBranch": params.Branch already names the remote branch directly (the
		// UI picks it from the remote-branch list itself, not from a local branch's upstream), so
		// no resolution applies here.
		argv = gitops.DeleteRemoteBranchArgs(params.Remote, params.Branch)
	}

	var res gitclient.Result
	if err := e.withAskpass(ctx, conn, deps, func(env []string) error {
		r, rerr := e.runRemoteSpawn(ctx, argv, env, onStderr)
		res = r
		return rerr
	}); err != nil {
		return nil, nil, err
	}

	statuses, perr := gitops.ParsePushPorcelain(res.Stdout)
	if perr != nil {
		return nil, nil, perr
	}
	updates := gitops.PushUpdates(statuses)

	if ctx.Err() != nil {
		return updates, &RemoteOpError{Kind: "Cancelled", Message: "the push was cancelled"}, nil
	}
	if res.ExitCode == 0 {
		return updates, nil, nil
	}

	porcelainReason := ""
	for _, s := range statuses {
		if s.Flag == '!' && s.Reason != "" {
			porcelainReason = s.Reason
			break
		}
	}
	kind, message := gitops.ClassifyRemoteError(porcelainReason, string(res.Stderr), res.ExitCode)
	opErr := &RemoteOpError{Kind: kind, Message: message}
	if kind == "HookRejected" {
		if rm := gitops.ExtractRemoteMessage(string(res.Stderr)); rm != "" {
			opErr.RemoteMessage = &rm
		}
	}
	return updates, opErr, nil
}

// runPullOp executes D18's two tracked steps: fetch the one branch (killable), then exactly one of
// merge --ff-only/merge --no-edit/rebase against the just-fetched remote-tracking ref (NEVER
// killable — a genuine local write, gated by Repo.Write exactly like G5's own ops, D11). A
// conflicting merge/rebase lands in G5's own in-progress banner — this adds no detection of its
// own (D18).
func (e *RepoEntry) runPullOp(roCtx, spawnCtx context.Context, conn *Conn, deps RemoteDeps, params RemoteOpParams, onStderr func([]byte)) ([]gitops.RefUpdate, *RemoteOpError, error) {
	e.remoteOp.setKillable(true)

	// G32 round-3 functional-correctness review, finding #1: fetch/merge/rebase must target the
	// branch's OWN upstream-side name (resolveUpstreamRemoteBranch), not assume it shares the local
	// branch's name — see that helper's own doc comment.
	remoteBranch, _, uerr := e.resolveUpstreamRemoteBranch(roCtx, params.Remote, params.Branch)
	if uerr != nil {
		return nil, nil, uerr
	}

	before, err := e.refSnapshot(roCtx)
	if err != nil {
		return nil, nil, err
	}
	fetchArgv := gitops.FetchRefspecArgs(params.Remote, remoteBranch, params.Prune)
	var fetchRes gitclient.Result
	if err := e.withAskpass(spawnCtx, conn, deps, func(env []string) error {
		r, rerr := e.runRemoteSpawn(spawnCtx, fetchArgv, env, onStderr)
		fetchRes = r
		return rerr
	}); err != nil {
		return nil, nil, err
	}
	after, err := e.refSnapshot(roCtx)
	if err != nil {
		return nil, nil, err
	}
	updates, err := e.diffRefSnapshots(roCtx, before, after)
	if err != nil {
		return nil, nil, err
	}

	if spawnCtx.Err() != nil {
		return updates, &RemoteOpError{Kind: "Cancelled", Message: "the pull was cancelled"}, nil
	}
	if fetchRes.ExitCode != 0 {
		kind, message := gitops.ClassifyRemoteError("", string(fetchRes.Stderr), fetchRes.ExitCode)
		return updates, &RemoteOpError{Kind: kind, Message: message}, nil
	}

	// G30 round-1 functional-correctness review, finding #2: unlike forcePush's own re-check above
	// (step 3, D12) and every other write in this chapter ("a pre-flight is advice, not a lock",
	// ops.go's own prepareReset doc comment), this integrate phase never re-verified HEAD was still
	// params.Branch before merging/rebasing INTO WHATEVER IS CHECKED OUT NOW. The fetch above can
	// take an arbitrary amount of wall-clock time (network, credential prompt) during which another
	// window/terminal can check out a different branch — the merge/rebase below would then silently
	// write onto that branch instead, with no error. Re-read fresh, immediately before the write
	// this gates, same shape as prepareReset's own fresh in-progress re-check.
	head, herr := e.Head(roCtx)
	if herr != nil {
		return updates, nil, herr
	}
	if head.Kind != "branch" || head.Name != params.Branch {
		return updates, &RemoteOpError{
			Kind:    "BranchChanged",
			Message: fmt.Sprintf("%s is no longer checked out — the pull was not applied", params.Branch),
		}, nil
	}

	// Past this point the op is a local write and is never killable again (D19).
	e.remoteOp.setKillable(false)

	// G32 round-3 functional-correctness review, finding #2: RunOp's own undo slot is invalidated
	// by every LOCAL write it performs (D6's "the very next operation clears it," SPEC §7.12) — a
	// pull's merge/rebase step is exactly such a write, but remote.run never went through RunOp and
	// so never touched the slot at all. Left alone, a reset's undo record survives a subsequent
	// pull: the record's replay is an absolute ref write (`reset --mixed <origHead>`,
	// `reset --keep <oldOID>`) that assumes nothing has moved the branch since it was captured —
	// exactly what this pull is about to do. Cleared unconditionally, before the write is even
	// attempted: a conflicting merge/rebase is caught by the in-progress banner before any new
	// destructive op could run anyway, so there is no cost to treating "pull reached its local
	// write phase" as invalidating, the same way RunOp treats reaching its own write phase.
	e.undo.Set(nil)

	upstream := "refs/remotes/" + params.Remote + "/" + remoteBranch
	var integrateArgv []string
	switch gitpreflight.PullStrategy(params.Strategy) {
	case gitpreflight.PullMerge:
		integrateArgv = gitops.MergeArgs(upstream)
	case gitpreflight.PullRebase:
		integrateArgv = gitops.RebaseArgs(upstream)
	default:
		integrateArgv = gitops.MergeFFOnlyArgs(upstream)
	}

	var opErr *RemoteOpError
	writeErr := e.Repo.Write(roCtx, func(wctx context.Context) error {
		res, rerr := gitclient.Run(wctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
			Dir: repoWorkingDir(e.Summary), Args: integrateArgv, ReadOnly: false,
			// G8 D6 (F6): this is a local write (merge/rebase), not the fetch above — a signing
			// passphrase prompt or a merge driver here would otherwise hang Repo.Write, blocking
			// every read in every window sharing this repository (G7 F8).
			Setsid: true,
		})
		if rerr != nil {
			return rerr
		}
		if res.ExitCode != 0 {
			// Probed here, real git 2.43: a merge conflict's own "CONFLICT (content): …" line is
			// on STDOUT, while a rebase conflict's "could not apply …" is on stderr — combined so
			// ClassifyOpError's existing Conflict row (ported from G5, stderr-only there because
			// checkout/revert never put anything actionable on stdout) sees whichever one fired.
			combined := string(res.Stdout) + "\n" + string(res.Stderr)
			kind, message := gitops.ClassifyRemoteError("", combined, res.ExitCode)
			opErr = &RemoteOpError{Kind: kind, Message: message}
		}
		return nil
	})
	if writeErr != nil {
		return updates, nil, writeErr
	}
	return updates, opErr, nil
}

// parseAheadBehind parses `rev-list --left-right --count`'s own "A\tB\n" output (probe P11).
func parseAheadBehind(raw []byte) (ahead, behind int, err error) {
	fields := strings.Fields(strings.TrimSpace(string(raw)))
	if len(fields) != 2 {
		return 0, 0, fmt.Errorf("gitsession: ahead/behind output has %d fields, want 2: %q", len(fields), raw)
	}
	if ahead, err = strconv.Atoi(fields[0]); err != nil {
		return 0, 0, err
	}
	if behind, err = strconv.Atoi(fields[1]); err != nil {
		return 0, 0, err
	}
	return ahead, behind, nil
}

// PushPreflight is remote.pushPreflight's own orchestration (D12/F15): the remote-tracking ref's
// own existence/sha stands in for "upstream" here — a branch with no upstream, or one whose
// remote-tracking ref has been pruned, is the common case wouldSetUpstream exists to describe
// (F15) — and ahead/behind is read ONLY once that ref is confirmed to exist (rev-list dies on a
// missing ref, probe P11). The ref checked is the branch's REAL upstream-side name
// (resolveUpstreamRemoteBranch, G32 round-3 finding #3), not an assumed same-name one — a branch
// already tracking a differently-named upstream must never be reported as "would set upstream"
// just because no same-named ref happens to exist yet.
func (e *RepoEntry) PushPreflight(ctx context.Context, remote, branch string) (gitpreflight.PushPreflight, error) {
	protectedBranches, _, _ := e.settings()

	remoteBranch, _, uerr := e.resolveUpstreamRemoteBranch(ctx, remote, branch)
	if uerr != nil {
		return gitpreflight.PushPreflight{}, uerr
	}

	tipRes, err := e.runAllowingExit(ctx, gitops.RemoteTipArgs(remote, remoteBranch), 0, 1)
	if err != nil {
		return gitpreflight.PushPreflight{}, err
	}

	var remoteTip, upstream *string
	var ahead, behind int
	if tipRes.ExitCode == 0 {
		tip := strings.TrimSpace(string(tipRes.Stdout))
		remoteTip = &tip
		ref := "refs/remotes/" + remote + "/" + remoteBranch
		upstream = &ref

		abRaw, abErr := e.runOne(ctx, gitops.AheadBehindArgs("refs/heads/"+branch, ref))
		if abErr != nil {
			return gitpreflight.PushPreflight{}, abErr
		}
		ahead, behind, err = parseAheadBehind(abRaw)
		if err != nil {
			return gitpreflight.PushPreflight{}, err
		}
	}

	return gitpreflight.ClassifyPush(gitpreflight.ClassifyPushInput{
		Branch: branch, Upstream: upstream, Ahead: ahead, Behind: behind,
		RemoteTip: remoteTip, ProtectedBranches: protectedBranches,
	}), nil
}

// parsePullConfig parses gitops.PullConfigArgs' own `--null` output (F16/probe P10):
// NUL-terminated records, key and value separated by a NEWLINE — not the space-separated form
// captureBranchDeleteUndo already parses, a different format that happens to live in this same
// package.
func parsePullConfig(raw []byte, branch string) gitpreflight.PullConfigValues {
	var cfg gitpreflight.PullConfigValues
	branchKey := "branch." + branch + ".rebase"
	for _, rec := range strings.Split(string(raw), "\x00") {
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\n", 2)
		if len(parts) != 2 {
			continue
		}
		key, value := parts[0], parts[1]
		switch key {
		case branchKey:
			v := value
			cfg.BranchRebase = &v
		case "pull.rebase":
			v := value
			cfg.PullRebase = &v
		case "pull.ff":
			v := value
			cfg.PullFf = &v
		}
	}
	return cfg
}

// PullPreflight is remote.pullPreflight's own orchestration (D18): one config --null --get-regexp
// spawn feeds the strategy ladder; upstream/ahead/behind come from the branch's own for-each-ref
// row (the SAME %(upstream)/%(upstream:track) fields refs.list already computes, D10's own
// precedent — no second, hand-rolled resolution of "this branch's own configured upstream"). A
// "gone" remote-tracking ref (config still points at it, but for-each-ref can no longer resolve
// it) reports ahead/behind as 0 rather than guessing.
func (e *RepoEntry) PullPreflight(ctx context.Context, branch, strategySetting string) (gitpreflight.PullPreflight, error) {
	cfgRaw, err := e.runAllowingExit(ctx, gitops.PullConfigArgs(branch), 0, 1)
	if err != nil {
		return gitpreflight.PullPreflight{}, err
	}
	cfg := parsePullConfig(cfgRaw.Stdout, branch)
	strategy, source := gitpreflight.ResolvePullStrategy(nil, strategySetting, cfg)

	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return gitpreflight.PullPreflight{}, err
	}
	var upstream *string
	var ahead, behind int
	for _, r := range snapshot.Branches {
		if r.ShortName != branch {
			continue
		}
		upstream = r.Upstream
		if track, ok := r.Track.(porcelain.RefTrack); ok {
			ahead, behind = track.Ahead, track.Behind
		}
		break
	}

	statusResult, _, err := e.statusAndInProgress(ctx)
	if err != nil {
		return gitpreflight.PullPreflight{}, err
	}
	dirty := len(gitpreflight.DirtyPaths(statusResult)) > 0

	return gitpreflight.ClassifyPull(gitpreflight.ClassifyPullInput{
		Strategy: strategy, Source: source, Upstream: upstream, Ahead: ahead, Behind: behind, Dirty: dirty,
	}), nil
}
