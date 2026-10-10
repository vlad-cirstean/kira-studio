package ade

import (
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
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
	// Space adds the Kira Space tools line after the body.
	Space bool
	// Context lines (a rebase that did not finish) go after the body.
	Context []string
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
	if len(in.Context) > 0 {
		body += "\n\n" + strings.Join(in.Context, "\n")
	}
	if in.Space {
		body += "\n\n" + claudeheadless.SpaceSuffix
	}
	return body + "\n\n" + claudeheadless.FinishStepSuffixFor(resultSpecs(in.Def.Results)) + "\n"
}

// composeResumePrompt is the message a resumed run gets: the line, then the finish_step instruction.
func composeResumePrompt(line string, results []adewire.StepResult) string {
	return line + "\n\n" + claudeheadless.FinishStepSuffixFor(resultSpecs(results)) + "\n"
}

// repoLine is one repo of a launch message.
type repoLine struct {
	Nick, Branch, Worktree string
	// Base is the branch's base ref, shown in the review message only.
	Base string
	// ReadOnlyRoot, when set, makes the line a read-only repo in that directory.
	ReadOnlyRoot string
}

func (l repoLine) String() string {
	if l.ReadOnlyRoot != "" {
		return fmt.Sprintf("- Repo: %s (read only, in %s)", l.Nick, l.ReadOnlyRoot)
	}
	return fmt.Sprintf("- Repo: %s · Branch: %s · Worktree: %s", l.Nick, l.Branch, l.Worktree)
}

func jiraLine(key, url string) string {
	if key == "" {
		return ""
	}
	return fmt.Sprintf("- Jira: %s %s", key, url)
}

// composeStageMessage is the first message of a user stage's interactive session (SPEC2 section 5).
// The stage prompt sees every writable repo, joined with ", ".
func composeStageMessage(stage adewire.Stage, title, jiraKey, jiraURL, notes string, repos []repoLine) string {
	var lines []string
	lines = append(lines, fmt.Sprintf("%s: %s", stage.Name, title))
	if l := jiraLine(jiraKey, jiraURL); l != "" {
		lines = append(lines, l)
	}
	for _, r := range repos {
		lines = append(lines, r.String())
	}
	vars := repoVars(title, jiraKey, repos)
	if notes != "" {
		lines = append(lines, "- Notes: "+capNotes(notes))
	}
	if stage.Prompt != "" {
		lines = append(lines, substitute(stage.Prompt, vars, false))
	}
	return strings.Join(lines, "\n")
}

// repoVars is the stage prompt's variable set: every writable repo, joined with ", ".
func repoVars(title, jiraKey string, repos []repoLine) runVars {
	vars := runVars{Task: title, Jira: jiraKey}
	var nicks, names, trees []string
	for _, r := range repos {
		if r.ReadOnlyRoot == "" {
			nicks, names, trees = append(nicks, r.Nick), append(names, r.Branch), append(trees, r.Worktree)
		}
	}
	vars.Repo, vars.Branch, vars.Worktree = strings.Join(nicks, ", "), strings.Join(names, ", "), strings.Join(trees, ", ")
	return vars
}

const reviewNotesMax = 2000

// capNotes keeps a session's first message well under the terminal's command bound.
func capNotes(notes string) string {
	if r := []rune(notes); len(r) > reviewNotesMax {
		return string(r[:reviewNotesMax])
	}
	return notes
}

// composeReviewMessage is the first message of a task's review agent.
func composeReviewMessage(title, jiraKey, jiraURL, notes string, repos []repoLine) string {
	lines := []string{"Task: " + title}
	if l := jiraLine(jiraKey, jiraURL); l != "" {
		lines = append(lines, l)
	}
	if notes != "" {
		lines = append(lines, "- Notes: "+capNotes(notes))
	}
	for _, r := range repos {
		if r.ReadOnlyRoot != "" {
			lines = append(lines, fmt.Sprintf("- %s: read only, in %s", r.Nick, r.ReadOnlyRoot))
			continue
		}
		lines = append(lines, fmt.Sprintf("- %s: %s (base %s) worktree %s", r.Nick, r.Branch, r.Base, r.Worktree))
	}
	lines = append(lines, "I review these branches in Kira Space and will ask you questions about them. Answer from the code; change files only when I ask you to.")
	return strings.Join(lines, "\n")
}

// composeStartMessage is the first message of a branch-level Start session (SPEC2 section 9); step
// is the first step not done, "" when the stage has none.
func composeStartMessage(title, jiraKey, jiraURL string, repo repoLine, step string, context []string) string {
	lines := []string{"Task: " + title}
	if l := jiraLine(jiraKey, jiraURL); l != "" {
		lines = append(lines, l)
	}
	lines = append(lines, repo.String())
	if step != "" {
		lines = append(lines, "Step: "+step)
	}
	lines = append(lines, context...)
	return strings.Join(lines, "\n")
}
