package ade

import (
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
)

// composeRebasePrompt is the one rebase prompt: the preview shows it, the run sends it. The fixed
// report suffix is appended separately so an edited message keeps it.
func composeRebasePrompt(src llmprompts.Source, spec model.AdeRebaseSpec) string {
	if len(spec.Stack) == 0 {
		return ""
	}
	stack := make([]llmprompts.RebaseStackVar, len(spec.Stack))
	for i, st := range spec.Stack {
		stack[i] = llmprompts.RebaseStackVar{
			Name: st.Name, Worktree: st.Worktree, ParentRef: st.ParentRef, ParentName: st.ParentName, ParentBefore: st.ParentBefore,
		}
	}
	return llmprompts.AdeRebasePrompt.Text(src, llmprompts.RebaseVars{
		Repo: spec.Repo, Onto: spec.OntoName, Remote: spec.Remote, Review: spec.Review,
		Autostash: spec.Autostash, Push: spec.Push, Stack: stack,
	})
}

// rebaseRunPrompt is what the agent receives: the (possibly edited) message and the report suffix.
func rebaseRunPrompt(src llmprompts.Source, message string) string {
	return strings.TrimRight(message, "\n") + "\n\n" + claudeheadless.RebaseReport(src)
}
