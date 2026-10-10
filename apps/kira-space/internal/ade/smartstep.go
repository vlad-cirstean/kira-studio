package ade

import (
	"fmt"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// smartStep is a workflow step that runs a smart script: the script's prompt, tools, model and budget
// replace the step prompt, and the run is isolated from the user's Claude settings (D8, D9).
type smartStep struct {
	script  scripts.CustomScript
	prompt  string
	env     []string
	dir     string
	timeout time.Duration
}

// planSmartStep resolves def's smart script for a run on sb. It has no side effect apart from
// creating the script's own folder when the script does not run in the worktree.
func (b *TaskBoard) planSmartStep(tc *taskCtx, sb model.AdeTaskBranch, path string, def stepDef) (*smartStep, error) {
	fail := func(format string, a ...any) (*smartStep, error) {
		return nil, invalid("smart script %q: %s", def.SmartScript, fmt.Sprintf(format, a...))
	}
	if b.deps.CustomScripts == nil {
		return fail("scripts are not available")
	}
	all, err := b.deps.CustomScripts.List()
	if err != nil {
		return nil, err
	}
	var found []scripts.CustomScript
	for _, s := range all {
		if s.Kind == scripts.KindSmart && s.Name == def.SmartScript && s.Smart != nil {
			found = append(found, s)
		}
	}
	switch len(found) {
	case 0:
		return fail("not found")
	case 1:
	default:
		return fail("%d scripts have that name", len(found))
	}
	script := found[0]
	vals, missing, err := scripts.ParamValues(script.Params, def.Params)
	if err != nil {
		return fail("%s", err)
	}
	if len(missing) > 0 {
		return fail("needs a value for %s", strings.Join(missing, ", "))
	}
	rendered := b.adeVars(tc, sb, path)
	env := []string{}
	for _, name := range scripts.BuiltinVars {
		env = append(env, scripts.BuiltinEnv(name)+"="+rendered[name])
	}
	for _, v := range vals {
		env = append(env, scripts.EnvName(v.Name)+"="+v.Env)
		if !v.Secret {
			rendered[v.Name] = v.Rendered
		}
	}
	step := &smartStep{script: script, env: env, dir: path, timeout: script.Smart.TimeoutDuration()}
	if def.Timeout != "" {
		step.timeout = parseStepTimeout(def.Timeout)
	}
	if !script.UseAdeDir {
		dir := scripts.ResolveDir(script, b.deps.ScriptsHome)
		if err := scripts.PrepareDir(dir); err != nil {
			return fail("%s", err)
		}
		step.dir = dir.Path
	}
	body := scripts.PlainText(scripts.Compose(script.Command, rendered))
	suffix := claudeheadless.FinishStepSuffix
	if b.spaceEnabled(tc.task) {
		suffix = claudeheadless.SpaceSuffix + "\n\n" + suffix
	}
	step.prompt = body + "\n\n" + suffix
	return step, nil
}

// mcpNames are the user MCP servers the script ticked.
func (s *smartStep) mcpNames() []string {
	names := make([]string, 0, len(s.script.Smart.MCP))
	for _, c := range s.script.Smart.MCP {
		names = append(names, c.Server)
	}
	return names
}

// spec is the process spec of a smart step run; the caller adds the MCP config paths.
func (s *smartStep) spec(base claudeheadless.Spec, space bool) claudeheadless.Spec {
	extra := []string{claudeheadless.FinishStepTool, claudeheadless.RunOutcomeTool}
	if space {
		extra = append(extra, claudeheadless.SpaceToolNames...)
	}
	base.Dir, base.Model, base.MaxBudgetUSD, base.Isolated = s.dir, s.script.Smart.Model, s.script.Smart.MaxBudgetUSD, true
	base.Tools, base.AllowedTools = scripts.ToolArgs(*s.script.Smart, extra)
	base.SettingSources = ""
	base.Env = append(base.Env, s.env...)
	base.Timeout = s.timeout
	return base
}

// smartOutcome is a smart step's outcome: a finish_step call wins, then the result event (budget,
// turn limit, error), then how the process ended. The cost and denials of the result event are added.
func (b *TaskBoard) smartOutcome(runID string, exit claudeheadless.Exit, runErr error, res *claudeheadless.Result, step *smartStep, lastErr string) outcome {
	var out outcome
	if f, finished := b.takeFinish(runID); finished {
		code := exit.Code
		out = fromFinish(f, &code)
	} else if o, ok := claudeheadless.ResultOutcome(res, exit.Code, step.script.Smart.MaxBudgetUSD); ok {
		out = fromOutcome(model.AdeRunFailed, o.WithLastError(lastErr))
	} else {
		o := runoutcome.ForProcess(agentEnd(exit, runErr, formatTimeout(step.timeout))).WithLastError(lastErr)
		out = fromOutcome(model.AdeRunFailed, o)
	}
	out.out.Outcome = claudeheadless.ApplyResult(out.out.Outcome, res)
	out.note = out.out.Reason
	return out
}
