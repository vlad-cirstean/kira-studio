package ade

import (
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeagent"
)

// runVars are the prompt and command variables of one run (SPEC2 section 5.1.1).
type runVars struct {
	Task, Jira, Repo, Branch, Worktree string
}

// substitute fills {task} {jira} {repo} {branch} {worktree} in one pass, so a value that contains
// a placeholder is not expanded again. quote single-quotes each value: script commands run in a
// shell, and task titles and branch names must not reach it unquoted.
func substitute(text string, v runVars, quote bool) string {
	val := func(s string) string {
		if quote {
			return quotePOSIX(s)
		}
		return s
	}
	return strings.NewReplacer(
		"{task}", val(v.Task), "{jira}", val(v.Jira), "{repo}", val(v.Repo),
		"{branch}", val(v.Branch), "{worktree}", val(v.Worktree),
	).Replace(text)
}

// promptInput is what composePrompt needs about the run.
type promptInput struct {
	Title, JiraKey, JiraURL string
	Vars                    runVars
	Step, Of                int // 1-based position and step count
	Def                     stepDef
	// Message, when non-empty, replaces the composed prompt (the Run dialog's edited text).
	Message string
	// Extra, when non-empty, is added after the body (the failure line of a fresh send-back run).
	Extra string
}

// composePrompt builds an agent run's prompt (SPEC2 section 9 "Start step" shape) and always ends
// it with the finish_step instruction.
func composePrompt(in promptInput) string {
	var body string
	if in.Message != "" {
		body = substitute(in.Message, in.Vars, false)
	} else {
		var sb strings.Builder
		fmt.Fprintf(&sb, "Task: %s\n", in.Vars.Task)
		if in.JiraKey != "" {
			fmt.Fprintf(&sb, "- Jira: %s %s\n", in.JiraKey, in.JiraURL)
		}
		fmt.Fprintf(&sb, "- Repo: %s · Branch: %s · Worktree: %s\n", in.Vars.Repo, in.Vars.Branch, in.Vars.Worktree)
		fmt.Fprintf(&sb, "Step %d/%d: %s\n", in.Step, in.Of, in.Def.Name)
		sb.WriteString(substitute(in.Def.Prompt, in.Vars, false))
		body = sb.String()
	}
	body = strings.TrimRight(body, "\n")
	if in.Extra != "" {
		body += "\n\n" + in.Extra
	}
	return body + "\n\n" + adeagent.FinishStepSuffix + "\n"
}

// composeResumePrompt is the message a resumed run gets: the line, then the finish_step instruction.
func composeResumePrompt(line string) string {
	return line + "\n\n" + adeagent.FinishStepSuffix + "\n"
}
