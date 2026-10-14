package ade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agentsandbox"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// sandbox.go confines headless agents (P287): it resolves each run's policy, applies the prepared
// sandbox to the process spec, records the denials and serves the sandbox git tools.

// sandboxRun is the live sandbox of one run.
type sandboxRun struct {
	access   agentsandbox.Access
	prep     agentsandbox.Prepared
	policy   agentsandbox.Policy
	tracker  agentsandbox.Tracker
	keychain bool
	push     bool
	grant    *claudeheadless.SandboxGrant
	scratch  string
	notes    []string
}

// sandboxTarget is what the sandbox git tools act on: the run's own repo, branch and worktree.
type sandboxTarget struct {
	codeRepoID, branch, worktree string
}

// sandboxGrantFor is the tool grant of a run: nil when no sandbox git tool applies (rebase runs keep
// their `git` tool, access off runs are unconfined).
func sandboxGrantFor(rebase bool, access agentsandbox.Access) *claudeheadless.SandboxGrant {
	if rebase || access == agentsandbox.AccessOff {
		return nil
	}
	return &claudeheadless.SandboxGrant{Push: access == agentsandbox.AccessWrite}
}

// sandboxInput builds the policy input of a launch.
func (b *TaskBoard) sandboxInput(run model.AdeRun, l agentLaunch, sd adewire.StepSandbox) (agentsandbox.Input, error) {
	in := agentsandbox.Input{
		RunID: run.ID, Access: agentsandbox.Access(sd.Access), Read: sd.Read, Allow: sd.Allow, Network: sd.Network,
		Scratch: filepath.Join(b.deps.AgentDir, "sandbox", run.ID), Cache: filepath.Join(b.deps.AgentDir, "sandbox-cache"),
		Ports: []int{b.agent.Port()}, RunDir: l.path,
	}
	if b.deps.SandboxKeychain != nil {
		in.Keychain = b.deps.SandboxKeychain()
	}
	if run.Purpose == model.AdeRunPurposeRebase {
		spec, err := specOf(run)
		if err != nil {
			return in, err
		}
		in.Access, in.Network = agentsandbox.AccessWrite, true
		in.Worktrees = rebaseWorktrees(spec)
		in.Branch = map[string]string{}
		for _, st := range spec.Stack {
			if st.Worktree != "" {
				in.Branch[st.Worktree] = st.Name
			}
		}
		return in, nil
	}
	sb, err := b.deps.Tasks.GetBranch(run.BranchID)
	if err != nil {
		return in, err
	}
	in.Branch = map[string]string{l.worktree: sb.Name}
	switch {
	case l.path == l.worktree:
		in.Worktrees = []string{l.worktree}
	case in.Access == agentsandbox.AccessWrite: // a smart step writes its own folder and reads the task worktree
		in.Worktrees, in.ReadWorktrees = []string{l.path}, []string{l.worktree}
	default:
		in.Worktrees, in.Read = []string{l.worktree}, append(slices.Clone(in.Read), l.path)
	}
	return in, nil
}

// prepareSandbox resolves and prepares the run's sandbox and stores its row. It returns nil when the
// board has no enforcer. Access off stores a row and applies nothing.
func (b *TaskBoard) prepareSandbox(ctx context.Context, run model.AdeRun, l agentLaunch) (*sandboxRun, error) {
	if b.deps.Sandbox == nil {
		return nil, nil
	}
	sd := l.def.Sandbox.Normalized()
	rebase := run.Purpose == model.AdeRunPurposeRebase
	if rebase {
		sd = adewire.DefaultSandbox()
	}
	sr := &sandboxRun{access: agentsandbox.Access(sd.Access)}
	if sr.access == agentsandbox.AccessOff {
		return sr, b.storeSandbox(run.ID, sr, false, "")
	}
	in, err := b.sandboxInput(run, l, sd)
	if err != nil {
		return nil, err
	}
	rt := agentsandbox.DiscoverRuntime(ctx, cmpNonEmpty(b.deps.ClaudeBin, "claude"))
	pol, notes, err := agentsandbox.ResolvePolicy(in, rt)
	if err != nil {
		return nil, err
	}
	prep, err := b.deps.Sandbox.Prepare(pol, rt)
	if err != nil {
		_ = os.RemoveAll(pol.Scratch)
		return nil, err
	}
	sr.policy, sr.prep, sr.notes, sr.scratch, sr.keychain = pol, prep, notes, pol.Scratch, pol.Keychain
	sr.grant = sandboxGrantFor(rebase, sr.access)
	if sr.grant != nil {
		sb, err := b.deps.Tasks.GetBranch(run.BranchID)
		if err != nil {
			sr.cleanup()
			return nil, err
		}
		b.sandboxTargets.Store(run.ID, sandboxTarget{codeRepoID: sb.CodeRepoID, branch: sb.Name, worktree: l.worktree})
	}
	sup := b.deps.Sandbox.Support()
	if err := b.storeSandbox(run.ID, sr, sup.Enforced, sup.Reason); err != nil {
		sr.cleanup()
		return nil, err
	}
	return sr, nil
}

func (b *TaskBoard) storeSandbox(runID string, sr *sandboxRun, enforced bool, reason string) error {
	if b.deps.RunSandbox == nil {
		return nil
	}
	policy, profile := "{}", ""
	if sr.access != agentsandbox.AccessOff {
		raw, err := json.Marshal(sr.policy)
		if err != nil {
			return err
		}
		policy, profile = string(raw), sr.prep.Profile
	}
	return b.deps.RunSandbox.Insert(repos.AdeRunSandbox{
		RunID: runID, Access: string(sr.access), Enforced: enforced && sr.access != agentsandbox.AccessOff,
		Reason: reason, PolicyJSON: policy, Profile: profile,
	})
}

func (sr *sandboxRun) cleanup() {
	if sr != nil && sr.scratch != "" {
		_ = os.RemoveAll(sr.scratch)
	}
}

// endSandbox releases a run's sandbox: its tool target and scratch directory.
func (b *TaskBoard) endSandbox(runID string, sr *sandboxRun) {
	b.sandboxTargets.Delete(runID)
	sr.cleanup()
}

// on reports whether the run is confined.
func (sr *sandboxRun) on() bool { return sr != nil && sr.access != agentsandbox.AccessOff }

// apply adds the sandbox to the process spec: launch wrap, environment, permission flags, the tool
// names and the prompt note.
func (b *TaskBoard) applySandbox(spec claudeheadless.Spec, sr *sandboxRun, l agentLaunch) claudeheadless.Spec {
	if !sr.on() {
		return spec
	}
	spec.Sandbox = sr.prep.Exec
	spec.Env = agentsandbox.MergeEnv(spec.Env, sr.prep.Env)
	for _, d := range sr.prep.AddDirs {
		if !slices.Contains(spec.AddDirs, d) {
			spec.AddDirs = append(spec.AddDirs, d)
		}
	}
	spec.DisallowedTools = append(slices.Clone(spec.DisallowedTools), sr.prep.Disallowed...)
	if sr.grant != nil {
		spec.AllowedTools = append(slices.Clone(spec.AllowedTools), claudeheadless.SandboxToolNames...)
	}
	sd := l.def.Sandbox.Normalized()
	note := llmprompts.HeadlessSandboxNote.Text(b.prompts(), llmprompts.SandboxNoteVars{
		Access: string(sr.access), Worktree: sr.policy.RunDir, Read: sd.Read, Network: sr.policy.Network,
		Enforced: b.deps.Sandbox.Support().Enforced, Tools: sr.grant != nil,
	})
	spec.Prompt = strings.TrimRight(spec.Prompt, "\n") + "\n\n" + note
	return spec
}

// watchSandbox starts the denial watch for pid and returns the stop function.
func (b *TaskBoard) watchSandbox(run model.AdeRun, sr *sandboxRun, sink *logSink, pid int) func() {
	return b.deps.Sandbox.Watch(pid, run.ID, func(d agentsandbox.Denial) {
		if !sr.tracker.Add(d) {
			b.countDenial(run.ID, "")
			return
		}
		sink.add(logStdout, fmt.Sprintf("sandbox denied %s %s (%s)", d.Op, d.Target, d.Process))
		list, _ := sr.tracker.Snapshot()
		raw, err := json.Marshal(list)
		if err != nil {
			slog.Warn("ade: encode sandbox denials", "scope", "ade", "run", run.ID, "err", err)
			return
		}
		b.countDenial(run.ID, string(raw))
		if cur, err := b.deps.Tasks.GetRun(run.ID); err == nil {
			b.emitRuns(cur)
		}
	})
}

func (b *TaskBoard) countDenial(runID, listJSON string) {
	if b.deps.RunSandbox == nil {
		return
	}
	if err := b.deps.RunSandbox.AddDenial(runID, listJSON); err != nil {
		slog.Warn("ade: count sandbox denial", "scope", "ade", "run", runID, "err", err)
	}
}

// sandboxOutcome maps a failed run to its sandbox cause: a sign-in blocked by the keychain denial,
// else the first denial. lastErr is the last stderr line.
func (sr *sandboxRun) sandboxOutcome(out outcome, lastErr string) outcome {
	if !sr.on() || out.state != model.AdeRunFailed {
		return out
	}
	reason := out.out.Reason
	if !out.out.Reported && !sr.keychain && agentsandbox.IsAuthFailure(lastErr+" "+out.out.LastError) {
		reason = agentsandbox.AuthReason()
	} else {
		reason = sr.tracker.BlockedReason(reason)
	}
	out.note, out.out.Reason = reason, reason
	return out
}

// --- sandbox git tools ------------------------------------------------------------------------------

func (b *TaskBoard) sandboxTargetOf(runID string) (sandboxTarget, error) {
	v, ok := b.sandboxTargets.Load(runID)
	if !ok {
		return sandboxTarget{}, errors.New("this run has no sandbox git access")
	}
	return v.(sandboxTarget), nil
}

// FetchRemote implements claudeheadless.SandboxGit: it fetches one remote of the run's repo in the app.
func (b *TaskBoard) FetchRemote(ctx context.Context, runID, remote string) (claudeheadless.RemoteResult, error) {
	t, err := b.sandboxTargetOf(runID)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	mu := b.repoMutex(t.codeRepoID)
	mu.Lock()
	defer mu.Unlock()
	entry, err := b.openRepo(ctx, t.codeRepoID)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	names, err := entry.Remotes(ctx)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	if !slices.Contains(names, remote) {
		return claudeheadless.RemoteResult{}, fmt.Errorf("remote must be one of: %s", strings.Join(names, ", "))
	}
	res, err := entry.RunRemote(ctx, b.conn, gitsession.RemoteOpParams{Kind: "fetch", Remote: remote}, gitsession.RemoteDeps{Askpass: b.deps.Askpass})
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	return remoteResult(remote, t.branch, res)
}

// PushBranch implements claudeheadless.SandboxGit: it pushes the run's own task branch.
func (b *TaskBoard) PushBranch(ctx context.Context, runID string, force bool) (claudeheadless.RemoteResult, error) {
	t, err := b.sandboxTargetOf(runID)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	mu := b.repoMutex(t.codeRepoID)
	mu.Lock()
	defer mu.Unlock()
	entry, err := b.openRepo(ctx, t.codeRepoID)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	head, err := entry.WorktreeHeadRef(ctx, t.worktree)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	if head != "refs/heads/"+t.branch {
		return claudeheadless.RemoteResult{}, fmt.Errorf("your worktree is not on %s", t.branch)
	}
	remote := forcePushRemote(ctx, entry, t.branch)
	if remote == "" {
		return claudeheadless.RemoteResult{}, errors.New("the repo has no remote to push to")
	}
	pf, err := entry.PushPreflight(ctx, remote, t.branch)
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	if pf.ProtectedBy != nil {
		return claudeheadless.RemoteResult{}, fmt.Errorf("%s is a protected branch", t.branch)
	}
	params := gitsession.RemoteOpParams{Kind: "push", Remote: remote, Branch: t.branch, SetUpstream: pf.Upstream == nil}
	if force {
		params = gitsession.RemoteOpParams{Kind: "forcePush", Remote: remote, Branch: t.branch, ExpectedRemoteTip: pf.RemoteTip}
	}
	res, err := entry.RunRemote(ctx, b.conn, params, gitsession.RemoteDeps{Askpass: b.deps.Askpass})
	if err != nil {
		return claudeheadless.RemoteResult{}, err
	}
	out, err := remoteResult(remote, t.branch, res)
	b.notifyBoard()
	return out, err
}

// remoteResult turns a remote op result into the tool result; a failed op is an error with its message.
func remoteResult(remote, branch string, res gitsession.RemoteOpResult) (claudeheadless.RemoteResult, error) {
	if res.Error != nil {
		return claudeheadless.RemoteResult{}, errors.New(res.Error.Message)
	}
	var lines []string
	for _, u := range res.Updates {
		from, to := "none", "none"
		if u.From != nil {
			from = short(*u.From)
		}
		if u.To != nil {
			to = short(*u.To)
		}
		lines = append(lines, fmt.Sprintf("%s %s..%s", u.Ref, from, to))
	}
	if len(lines) == 0 {
		lines = append(lines, "up to date")
	}
	return claudeheadless.RemoteResult{Remote: remote, Branch: branch, Output: strings.Join(lines, "\n")}, nil
}

func short(sha string) string {
	if len(sha) > 8 {
		return sha[:8]
	}
	return sha
}

// noticeSandbox writes the sandbox's first log lines: the not-enforced notice and skipped paths.
func (b *TaskBoard) noticeSandbox(sink *logSink, sr *sandboxRun) {
	if !sr.on() {
		return
	}
	if sup := b.deps.Sandbox.Support(); !sup.Enforced {
		sink.add(logStdout, i18n.T(sup.Reason, nil))
	}
	for _, n := range sr.notes {
		sink.add(logStdout, n)
	}
}
