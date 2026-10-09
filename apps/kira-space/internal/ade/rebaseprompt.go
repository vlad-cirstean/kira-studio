package ade

import (
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
)

// composeRebasePrompt is the one rebase prompt: the preview shows it, the run sends it. The fixed
// report suffix is appended separately so an edited message keeps it.
func composeRebasePrompt(spec model.AdeRebaseSpec) string {
	if len(spec.Stack) == 0 {
		return ""
	}
	root := spec.Stack[0]
	stash := ""
	if spec.Autostash {
		stash = "--autostash "
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "Rebase %s (repo %s) onto %s", root.Name, spec.Repo, spec.OntoName)
	if len(spec.Stack) > 1 {
		sb.WriteString(", then restack the branches built on it")
	}
	sb.WriteString(":\n")
	for i, st := range spec.Stack {
		fmt.Fprintf(&sb, "%d. In %s: ", i+1, st.Worktree)
		if i == 0 {
			if spec.Remote != "" {
				fmt.Fprintf(&sb, "git fetch %s && ", spec.Remote)
			}
			fmt.Fprintf(&sb, "git rebase %s%s\n", stash, st.ParentRef)
			continue
		}
		fmt.Fprintf(&sb, "git rebase %s--onto %s %s\n", stash, st.ParentName, st.ParentBefore)
	}
	if spec.Review != "" {
		fmt.Fprintf(&sb, "Do not modify %s.\n", spec.Review)
	}
	sb.WriteString("Resolve any conflicts by editing the files, then git add and git rebase --continue.\n")
	if spec.Push {
		sb.WriteString("Then push each rebased branch with git push --force-with-lease.")
	} else {
		sb.WriteString("Do not push.")
	}
	return sb.String()
}

// rebaseRunPrompt is what the agent receives: the (possibly edited) message and the report suffix.
func rebaseRunPrompt(message string) string {
	return strings.TrimRight(message, "\n") + "\n\n" + claudeheadless.RebaseReportSuffix
}
