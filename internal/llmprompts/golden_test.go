package llmprompts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Golden files were generated from the pre-registry composition code; a default render over the same
// inputs must stay byte-identical.

func TestGolden(t *testing.T) {
	stack1 := []RebaseStackVar{{Name: "feat/login", Worktree: "/wt/kira-space/feat-login", ParentRef: "origin/main"}}
	stack3 := []RebaseStackVar{
		{Name: "feat/a", Worktree: "/wt/kira-space/feat-a", ParentRef: "origin/main"},
		{Name: "feat/b", Worktree: "/wt/kira-space/feat-b", ParentRef: "feat/a", ParentName: "feat/a", ParentBefore: "1a2b3c4"},
		{Name: "feat/c", Worktree: "/wt/kira-space/feat-c", ParentRef: "feat/b", ParentName: "feat/b", ParentBefore: "5d6e7f8"},
	}
	rebase := func(v RebaseVars) RebaseVars {
		v.Repo, v.Onto = "kira-space", "origin/main"
		return v
	}
	implicit := FinishVars{Implicit: true, Results: []ResultVar{{ID: "done", OK: true}, {ID: "failed"}}}
	declared := FinishVars{Results: []ResultVar{
		{ID: "pass", OK: true, Description: "All checks green"}, {ID: "fail", Description: "A check is red"}, {ID: "skip", OK: true},
	}}
	step := func(mod func(*StepVars)) StepVars {
		v := StepVars{
			Title: "Add login form", Repo: "kira-space", Branch: "feat/login", Worktree: "/wt/kira-space/feat-login",
			StepNumber: 2, StepCount: 5, StepName: "Implement",
			StepPrompt: "Implement Add login form in kira-space on feat/login.", Finish: implicit,
		}
		mod(&v)
		return v
	}
	const jiraKey, jiraURL = "KIRA-42", "https://jira.example.com/browse/KIRA-42"
	notes := []rune(strings.Repeat("abcdefghij", 250))
	capped := string(notes[:2000])
	repos := []RepoLineVars{
		{Repo: "kira-space", Branch: "feat/a", Worktree: "/wt/kira-space/feat-a", Base: "main"},
		{Repo: "docs", ReadOnlyRoot: "/repos/docs"},
	}
	startCtx := []string{"- Last rebase of feat/a failed: conflicts (run r1; call run_outcome for details)"}

	cases := []struct {
		name string
		p    ID
		v    any
	}{
		{"ade.rebase.prompt.single-nopush", AdeRebasePrompt.id, rebase(RebaseVars{Stack: stack1})},
		{"ade.rebase.prompt.single-remote-push", AdeRebasePrompt.id, rebase(RebaseVars{Stack: stack1, Remote: "origin", Push: true})},
		{"ade.rebase.prompt.stack3-autostash-nopush", AdeRebasePrompt.id, rebase(RebaseVars{Stack: stack3, Autostash: true})},
		{"ade.rebase.prompt.stack3-remote-review-push", AdeRebasePrompt.id, rebase(RebaseVars{Stack: stack3, Remote: "origin", Review: "review/feat-c", Push: true})},
		{"ade.rebase.prompt.single-review-autostash", AdeRebasePrompt.id, rebase(RebaseVars{Stack: stack1, Review: "review/feat-login", Autostash: true})},

		{"ade.step.prompt.default-implicit", AdeStepPrompt.id, step(func(*StepVars) {})},
		{"ade.step.prompt.jira", AdeStepPrompt.id, step(func(v *StepVars) { v.JiraKey, v.JiraURL = jiraKey, jiraURL })},
		{"ade.step.prompt.message", AdeStepPrompt.id, step(func(v *StepVars) { v.Message = "Do the thing for Add login form." })},
		{"ade.step.prompt.extra-context-space", AdeStepPrompt.id, step(func(v *StepVars) {
			v.Extra = "Verify failed on feat/login: tests red. Fix the implementation."
			v.Context = []string{
				"- Last rebase of feat/login failed: conflicts (run r1; call run_outcome for details)",
				"- Last rebase of feat/b needs input: which base? (run r2; call run_outcome for details)",
			}
			v.Space = true
		})},
		{"ade.step.prompt.declared-results", AdeStepPrompt.id, step(func(v *StepVars) { v.Finish = declared })},
		{"ade.step.prompt.empty-step-prompt", AdeStepPrompt.id, step(func(v *StepVars) { v.StepPrompt, v.StepNumber, v.StepCount = "", 1, 1 })},

		{"ade.stage.message.full", AdeStageMessage.id, StageVars{
			StageName: "Review", Title: "Add login form", JiraKey: jiraKey, JiraURL: jiraURL, Notes: capped, Repos: repos,
			StagePrompt: "Check kira-space on feat/a in /wt/kira-space/feat-a for Add login form.",
		}},
		{"ade.stage.message.minimal", AdeStageMessage.id, StageVars{StageName: "Plan", Title: "Add login form", Repos: repos[:1]}},
		{"ade.review.message.full", AdeReviewMessage.id, ReviewVars{Title: "Add login form", JiraKey: jiraKey, JiraURL: jiraURL, Notes: capped, Repos: repos}},
		{"ade.review.message.minimal", AdeReviewMessage.id, ReviewVars{Title: "Add login form", Repos: repos[:1]}},
		{"ade.start.message.step", AdeStartMessage.id, StartVars{
			Title: "Add login form", JiraKey: jiraKey, JiraURL: jiraURL, Repo: "kira-space", Branch: "feat/a",
			Worktree: "/wt/kira-space/feat-a", StepName: "Implement", Context: startCtx,
		}},
		{"ade.start.message.readonly-nostep", AdeStartMessage.id, StartVars{Title: "Add login form", Repo: "docs", ReadOnlyRoot: "/repos/docs"}},
		{"ade.rebase.contextLine.failed", AdeRebaseContextLine.id, RebaseContextVars{Branch: "feat/login", Outcome: "failed", Reason: "conflicts in a.go", RunID: "run-7"}},
		{"ade.sendBack.line.basic", AdeSendBackLine.id, SendBackVars{From: "Verify", Branch: "feat/login", Reason: "tests red"}},

		{"headless.finishStep.suffix.implicit", HeadlessFinishStepSuffix.id, implicit},
		{"headless.finishStep.suffix.implicit-pair", HeadlessFinishStepSuffix.id, implicit},
		{"headless.finishStep.suffix.declared", HeadlessFinishStepSuffix.id, declared},
		{"headless.finishStep.suffix.declared-nodesc", HeadlessFinishStepSuffix.id, FinishVars{Results: []ResultVar{{ID: "pass", OK: true}, {ID: "fail"}, {ID: "retry"}}}},

		{"memory.mcp.remember.message.empty", MemoryRememberMessage.id, RememberVars{}},
		{"memory.mcp.remember.message.blank", MemoryRememberMessage.id, RememberVars{}},
		{"memory.mcp.remember.message.given", MemoryRememberMessage.id, RememberVars{Text: "We use pnpm, not npm.\nCI runs on Linux."}},
	}
	files, err := filepath.Glob("testdata/golden/*.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(cases) {
		t.Fatalf("%d golden files, %d cases", len(files), len(cases))
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			want, err := os.ReadFile(filepath.Join("testdata", "golden", c.name+".txt"))
			if err != nil {
				t.Fatal(err)
			}
			if got := Render(Defaults(), c.p, c.v); got != string(want) {
				t.Fatalf("render differs from golden\n got: %q\nwant: %q", got, want)
			}
		})
	}
}
