package ade

import (
	"context"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
)

// rebaseCheck is what git showed after a rebase run ended. failure is the first failed check, ""
// when every branch is rebased onto its base with no operation left in progress.
type rebaseCheck struct {
	facts   model.RebaseFacts
	failure string
}

// verifyRebase reads every stack branch's worktree: no operation in progress, no unmerged path, HEAD
// on the branch, the tip on top of its base, and with Push the upstream at the tip.
func (b *TaskBoard) verifyRebase(ctx context.Context, spec model.AdeRebaseSpec) rebaseCheck {
	chk := rebaseCheck{facts: model.RebaseFacts{
		OntoRef: spec.OntoName, OntoTip: spec.OntoTipBefore, ConflictedFiles: []string{}, Branches: []model.BranchShas{},
	}}
	fail := func(format string, a ...any) {
		if chk.failure == "" {
			chk.failure = fmt.Sprintf(format, a...)
		}
	}
	entry, err := b.openRepo(ctx, spec.CodeRepoID)
	if err != nil {
		fail("could not read git: %v", err)
		return chk
	}
	parentTip, parentName := spec.OntoTipBefore, spec.OntoName
	pushed := true
	for _, st := range spec.Stack {
		sh := model.BranchShas{BranchID: st.BranchID, Name: st.Name, Before: st.Before}
		status, err := entry.WorktreeStatus(ctx, st.Worktree)
		if err != nil {
			fail("could not read %s: %v", st.Worktree, err)
			chk.facts.Branches = append(chk.facts.Branches, sh)
			continue
		}
		if op := entry.WorktreeInProgress(st.Worktree, status); op != nil {
			chk.facts.InProgress = true
			chk.facts.ConflictedFiles = append(chk.facts.ConflictedFiles, op.ConflictedPaths...)
			fail("a %s is still in progress in %s", opName(op), st.Worktree)
		} else if un := gitpreflight.UnmergedPaths(unmergedOnly(status)); len(un) > 0 {
			chk.facts.ConflictedFiles = append(chk.facts.ConflictedFiles, un...)
			fail("unmerged paths remain in %s", st.Worktree)
		}
		ref, tip, err := entry.WorktreeHead(ctx, st.Worktree)
		switch {
		case err != nil:
			fail("could not read HEAD in %s: %v", st.Worktree, err)
		case ref == "":
			fail("HEAD is detached in %s", st.Worktree)
		case ref != "refs/heads/"+st.Name:
			fail("%s is on %s, not %s", st.Worktree, ref, st.Name)
		}
		sh.After = tip
		if tip != "" {
			on, err := entry.IsAncestor(ctx, parentTip, tip)
			if err != nil {
				fail("could not compare %s with %s: %v", st.Name, parentName, err)
			}
			sh.OnBase = on && !chk.facts.InProgress
			if !on {
				fail("%s is not on top of %s", st.Name, parentName)
			}
		}
		if spec.Push && tip != "" {
			up, err := entry.WorktreeUpstreamTip(ctx, st.Worktree)
			if err != nil || up != tip {
				pushed = false
				fail("%s was not pushed", st.Name)
			}
		}
		chk.facts.Branches = append(chk.facts.Branches, sh)
		parentTip, parentName = tip, st.Name
	}
	if spec.Push {
		chk.facts.Pushed = &pushed
	}
	chk.facts.Verified = chk.failure == ""
	return chk
}

func unmergedOnly(entries []porcelain.StatusEntry) porcelain.StatusResult {
	return porcelain.StatusResult{Entries: entries}
}

func opName(op *gitpreflight.InProgressOperation) string {
	return string(op.Kind)
}

// decideRebaseOutcome turns the agent's report (nil: it never called finish_step), what git showed
// and how the process ended into the run's outcome. A claim of done holds only when git agrees.
func decideRebaseOutcome(f *claudeheadless.Finish, chk rebaseCheck, end outcome) outcome {
	facts := chk.facts
	if f == nil {
		out := end
		out.out.Rebase = &facts
		return out
	}
	o := runoutcome.Outcome{Source: runoutcome.SourceAgent, Reported: true, Summary: f.Summary, ExitCode: end.out.ExitCode}
	state := finishState(&o, *f, nil)
	if state == model.AdeRunDone && chk.failure != "" {
		o.Status, o.Source, o.Reason = runoutcome.StatusFailed, runoutcome.SourceVerify, "verification failed: "+chk.failure
		state = model.AdeRunFailed
	}
	out := fromOutcome(state, o)
	out.out.Report = reportOf(*f)
	out.out.Rebase = &facts
	return out
}
