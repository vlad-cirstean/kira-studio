// Package adeflow reads and writes ADE v2 workflow YAML files in <KiraSpaceHome>/workflows. It
// validates strictly (an unknown key is an error) and reports node line numbers. The Reader lists;
// writer.go edits files in place, preserving comments and key order.
package adeflow

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

const maxSmartScriptName = 200

const syntaxMessage = "unexpected content here (check the indentation)"

var (
	idPattern        = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)
	paramNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	toolPattern      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]*(\(.+\))?$`)
	mcpToolPattern   = regexp.MustCompile(`^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$`)
	yamlErrLine      = regexp.MustCompile(`line (\d+)`)
	maxStepTimeout   = 24 * time.Hour
	taskStatuses     = []string{"To do", "In progress", "In review", "Done"}
	stageKindAlias   = map[string]string{"user": "user", "manual": "user", "agent": "agent", "automated": "agent", "script": "script"}
	onFailureSimple  = map[string]bool{"stop": true, "retry 1": true, "retry 2": true}
)

// Parse decodes and validates one workflow file. src is the whole file; the file stem is checked
// separately by the Reader (Parse has no file name).
func Parse(src []byte) (adewire.Workflow, *adewire.WorkflowError) {
	var doc yaml.Node
	if err := yaml.Unmarshal(src, &doc); err != nil {
		line := 0
		if m := yamlErrLine.FindStringSubmatch(err.Error()); m != nil {
			line, _ = strconv.Atoi(m[1])
		}
		return adewire.Workflow{}, &adewire.WorkflowError{Line: line, Message: syntaxMessage}
	}
	if doc.Kind == 0 || len(doc.Content) == 0 {
		return adewire.Workflow{}, &adewire.WorkflowError{Message: "the file is empty"}
	}
	v := &validator{}
	wf := v.workflow(doc.Content[0])
	if v.err != nil {
		return adewire.Workflow{}, v.err
	}
	return wf, nil
}

// validator keeps the first error; every rule short-circuits on it.
type validator struct {
	err *adewire.WorkflowError
}

func (v *validator) fail(n *yaml.Node, prefix, format string, args ...any) {
	if v.err != nil {
		return
	}
	line := 0
	if n != nil {
		line = n.Line
	}
	v.err = &adewire.WorkflowError{Line: line, Message: prefix + fmt.Sprintf(format, args...)}
}

// fields maps a mapping node's keys to their value nodes, rejecting duplicates, non-scalar keys and
// keys outside allowed.
func (v *validator) fields(n *yaml.Node, prefix string, allowed ...string) map[string]*yaml.Node {
	out := make(map[string]*yaml.Node)
	if n.Kind != yaml.MappingNode {
		v.fail(n, prefix, "expected a mapping of keys")
		return out
	}
	ok := make(map[string]bool, len(allowed))
	for _, a := range allowed {
		ok[a] = true
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		k, val := n.Content[i], n.Content[i+1]
		if k.Kind != yaml.ScalarNode {
			v.fail(k, prefix, "keys must be plain words")
			return out
		}
		if !ok[k.Value] {
			v.fail(k, prefix, "unknown key %q", k.Value)
			return out
		}
		if _, dup := out[k.Value]; dup {
			v.fail(k, prefix, "duplicate key %q", k.Value)
			return out
		}
		out[k.Value] = val
	}
	return out
}

// str returns a scalar string field; required = fail when missing or empty.
func (v *validator) str(m map[string]*yaml.Node, prefix, key string, required bool) string {
	n, ok := m[key]
	if !ok {
		if required {
			v.failMissing(prefix, key)
		}
		return ""
	}
	if n.Kind != yaml.ScalarNode || n.Tag == "!!null" {
		v.fail(n, prefix, "%s must be text", key)
		return ""
	}
	val := n.Value
	if key == "prompt" || key == "command" {
		val = strings.TrimRight(val, "\n")
	} else {
		val = strings.TrimSpace(val)
	}
	if required && strings.TrimSpace(val) == "" {
		v.fail(n, prefix, "%s must not be empty", key)
	}
	return val
}

// failMissing reports a missing required key with line 0 (no node to point at).
func (v *validator) failMissing(prefix, key string) {
	v.fail(nil, prefix, "%s is required", key)
}

func (v *validator) boolean(m map[string]*yaml.Node, prefix, key string) bool {
	n, ok := m[key]
	if !ok {
		return false
	}
	if n.Kind != yaml.ScalarNode || n.Tag != "!!bool" {
		v.fail(n, prefix, "%s must be true or false", key)
		return false
	}
	return n.Value == "true"
}

func (v *validator) workflow(root *yaml.Node) adewire.Workflow {
	wf := adewire.Workflow{Stages: make([]adewire.Stage, 0)}
	m := v.fields(root, "", "id", "name", "kira_space_mcp", "stages")
	if v.err != nil {
		return wf
	}
	wf.ID = v.str(m, "", "id", true)
	if v.err == nil && !idPattern.MatchString(wf.ID) {
		v.fail(m["id"], "", "id must be lowercase letters, digits, - or _")
	}
	wf.Name = v.str(m, "", "name", true)
	wf.KiraSpaceMcp = v.boolean(m, "", "kira_space_mcp")
	if v.err != nil {
		return wf
	}
	list, ok := m["stages"]
	if !ok {
		v.failMissing("", "stages")
		return wf
	}
	if list.Kind != yaml.SequenceNode || len(list.Content) == 0 {
		v.fail(list, "", "stages must be a non-empty list")
		return wf
	}
	seen := make(map[string]bool)
	for i, sn := range list.Content {
		st := v.stage(sn, i+1)
		if v.err != nil {
			return wf
		}
		if seen[st.ID] {
			v.fail(sn, fmt.Sprintf("stage %d: ", i+1), "id %q is already used by another stage", st.ID)
			return wf
		}
		seen[st.ID] = true
		wf.Stages = append(wf.Stages, st)
	}
	if !slices.ContainsFunc(wf.Stages, func(s adewire.Stage) bool { return !s.Skip }) {
		v.fail(list, "", "at least one stage must not be skipped")
	}
	return wf
}

func (v *validator) stage(sn *yaml.Node, num int) adewire.Stage {
	prefix := fmt.Sprintf("stage %d: ", num)
	st := adewire.Stage{Steps: make([]adewire.PipelineStep, 0)}
	m := v.fields(sn, prefix, "id", "name", "kind", "status", "skip", "session", "prompt", "steps", "command", "runs_on", "on_failure", "timeout")
	if v.err != nil {
		return st
	}
	st.ID = v.str(m, prefix, "id", true)
	if v.err == nil && !idPattern.MatchString(st.ID) {
		v.fail(m["id"], prefix, "id must be lowercase letters, digits, - or _")
	}
	st.Name = v.str(m, prefix, "name", true)
	rawKind := v.str(m, prefix, "kind", true)
	if v.err != nil {
		return st
	}
	kind, ok := stageKindAlias[rawKind]
	if !ok {
		v.fail(m["kind"], prefix, "kind must be user, agent or script")
		return st
	}
	st.Kind = kind
	st.Status = v.str(m, prefix, "status", true)
	if v.err == nil && !contains(taskStatuses, st.Status) {
		v.fail(m["status"], prefix, "status must be To do, In progress, In review or Done")
	}
	st.Skip = v.boolean(m, prefix, "skip")
	if v.err != nil {
		return st
	}
	refuse := func(keys ...string) {
		for _, k := range keys {
			if n, has := m[k]; has {
				v.fail(n, prefix, "%s is not allowed on %s stages", k, kind)
				return
			}
		}
	}
	switch kind {
	case "user":
		refuse("steps", "command", "runs_on", "on_failure", "timeout")
		st.Session = v.boolean(m, prefix, "session")
		if v.err != nil {
			return st
		}
		if st.Session {
			st.Prompt = v.str(m, prefix, "prompt", false)
		} else {
			refuse("prompt")
		}
	case "agent":
		refuse("session", "command", "prompt", "runs_on", "on_failure", "timeout")
		if v.err != nil {
			return st
		}
		st.Steps = v.steps(m, prefix)
	case "script":
		refuse("steps", "session", "prompt")
		if v.err != nil {
			return st
		}
		st.Command = v.str(m, prefix, "command", true)
		st.RunsOn = v.runsOn(m, prefix)
		st.OnFailure = v.onFailure(m, prefix, nil)
		st.Timeout = v.timeout(m, prefix)
	}
	return st
}

func (v *validator) steps(m map[string]*yaml.Node, prefix string) []adewire.PipelineStep {
	out := make([]adewire.PipelineStep, 0)
	list, ok := m["steps"]
	if !ok {
		v.failMissing(prefix, "steps")
		return out
	}
	if list.Kind != yaml.SequenceNode || len(list.Content) == 0 {
		v.fail(list, prefix, "steps must be a non-empty list")
		return out
	}
	earlier := make(map[string]bool)
	for i, stepNode := range list.Content {
		sp := fmt.Sprintf("%sstep %d: ", prefix[:len(prefix)-2]+", ", i+1)
		sm := v.fields(stepNode, sp, "id", "name", "runs_on", "before", "on_failure", "timeout", "prompt", "allowed_tools", "smart_script", "params")
		if v.err != nil {
			return out
		}
		step := adewire.PipelineStep{AllowedTools: make([]string, 0), Params: map[string][]string{}}
		step.ID = v.str(sm, sp, "id", true)
		if v.err == nil && !idPattern.MatchString(step.ID) {
			v.fail(sm["id"], sp, "id must be lowercase letters, digits, - or _")
		}
		if v.err == nil && earlier[step.ID] {
			v.fail(sm["id"], sp, "id %q is already used by another step in this stage", step.ID)
		}
		step.Name = v.str(sm, sp, "name", true)
		step.RunsOn = v.runsOn(sm, sp)
		step.Before = "auto"
		if _, has := sm["before"]; has {
			step.Before = v.str(sm, sp, "before", true)
			if v.err == nil && step.Before != "auto" && step.Before != "approval" {
				v.fail(sm["before"], sp, "before must be auto or approval")
			}
		}
		step.OnFailure = v.onFailure(sm, sp, earlier)
		step.Timeout = v.timeout(sm, sp)
		v.stepBody(sm, sp, &step)
		if v.err != nil {
			return out
		}
		earlier[step.ID] = true
		out = append(out, step)
	}
	return out
}

// stepBody reads what a step runs: a prompt with its allowed tools, or a smart script with its params.
func (v *validator) stepBody(sm map[string]*yaml.Node, sp string, step *adewire.PipelineStep) {
	if _, smart := sm["smart_script"]; !smart {
		if n, has := sm["params"]; has {
			v.fail(n, sp, "params is only allowed with smart_script")
			return
		}
		step.Prompt = v.str(sm, sp, "prompt", true)
		step.AllowedTools = v.allowedTools(sm, sp)
		return
	}
	for _, key := range []string{"prompt", "allowed_tools"} {
		if n, has := sm[key]; has {
			v.fail(n, sp, "%s is not allowed with smart_script", key)
			return
		}
	}
	step.SmartScript = v.str(sm, sp, "smart_script", true)
	if v.err == nil && utf8.RuneCountInString(step.SmartScript) > maxSmartScriptName {
		v.fail(sm["smart_script"], sp, "smart_script must be at most %d characters", maxSmartScriptName)
	}
	step.Params = v.stepParams(sm, sp)
}

// stepParams reads params: a mapping from a param name to one text value or a list of them.
func (v *validator) stepParams(sm map[string]*yaml.Node, sp string) map[string][]string {
	out := map[string][]string{}
	n, has := sm["params"]
	if !has {
		return out
	}
	if n.Kind != yaml.MappingNode {
		v.fail(n, sp, "params must be a mapping of names to values")
		return out
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		k, val := n.Content[i], n.Content[i+1]
		if k.Kind != yaml.ScalarNode || !paramNamePattern.MatchString(k.Value) {
			v.fail(k, sp, "param name %q must be lowercase letters, digits or _, starting with a letter", k.Value)
			return out
		}
		if _, dup := out[k.Value]; dup {
			v.fail(k, sp, "duplicate param %q", k.Value)
			return out
		}
		vals, ok := scalarValues(val)
		if !ok {
			v.fail(val, sp, "param %q must be text or a list of text", k.Value)
			return out
		}
		out[k.Value] = vals
	}
	return out
}

// scalarValues is a scalar as one value, or a sequence of scalars; ok is false for anything else.
func scalarValues(n *yaml.Node) ([]string, bool) {
	isText := func(c *yaml.Node) bool { return c.Kind == yaml.ScalarNode && c.Tag != "!!null" }
	switch {
	case isText(n):
		return []string{n.Value}, true
	case n.Kind == yaml.SequenceNode:
		out := make([]string, 0, len(n.Content))
		for _, c := range n.Content {
			if !isText(c) {
				return nil, false
			}
			out = append(out, c.Value)
		}
		return out, true
	}
	return nil, false
}

// runsOn: once | each repo | only <repo> (syntax only; repos are checked at run time).
func (v *validator) runsOn(m map[string]*yaml.Node, prefix string) string {
	val := v.str(m, prefix, "runs_on", true)
	if v.err != nil {
		return val
	}
	switch {
	case val == "once", val == "each repo":
	case strings.HasPrefix(val, "only ") && strings.TrimSpace(strings.TrimPrefix(val, "only ")) != "":
		val = "only " + strings.TrimSpace(strings.TrimPrefix(val, "only "))
	default:
		v.fail(m["runs_on"], prefix, "runs_on must be once, each repo or only <repo>")
	}
	return val
}

// onFailure: stop | retry 1 | retry 2 | back:<earlier step id>. earlier == nil (script stage)
// refuses back:. Default stop.
func (v *validator) onFailure(m map[string]*yaml.Node, prefix string, earlier map[string]bool) string {
	n, has := m["on_failure"]
	if !has {
		return "stop"
	}
	val := v.str(m, prefix, "on_failure", true)
	if v.err != nil || onFailureSimple[val] {
		return val
	}
	if id, isBack := strings.CutPrefix(val, "back:"); isBack {
		if earlier == nil {
			v.fail(n, prefix, "back: is only allowed on an agent step")
		} else if !earlier[id] {
			v.fail(n, prefix, "back: must name an earlier step of the same stage")
		}
		return val
	}
	v.fail(n, prefix, "on_failure must be stop, retry 1, retry 2 or back:<step id>")
	return val
}

func (v *validator) timeout(m map[string]*yaml.Node, prefix string) string {
	val := v.str(m, prefix, "timeout", true)
	if v.err != nil {
		return val
	}
	d, err := time.ParseDuration(val)
	if err != nil || d <= 0 || d > maxStepTimeout {
		v.fail(m["timeout"], prefix, "timeout must be a duration such as 30m or 2h (at most 24h)")
	}
	return val
}

func (v *validator) allowedTools(m map[string]*yaml.Node, prefix string) []string {
	out := make([]string, 0)
	n, has := m["allowed_tools"]
	if !has {
		return out
	}
	if n.Kind != yaml.SequenceNode {
		v.fail(n, prefix, "allowed_tools must be a list")
		return out
	}
	seen := make(map[string]bool)
	for _, e := range n.Content {
		if e.Kind != yaml.ScalarNode || strings.ContainsAny(e.Value, "\r\n") || !(toolPattern.MatchString(e.Value) || mcpToolPattern.MatchString(e.Value)) {
			v.fail(e, prefix, "allowed_tools entry %q is not a tool pattern such as Bash(git *)", e.Value)
			return out
		}
		if seen[e.Value] {
			v.fail(e, prefix, "allowed_tools entry %q is listed twice", e.Value)
			return out
		}
		seen[e.Value] = true
		out = append(out, e.Value)
	}
	return out
}

func contains(list []string, s string) bool {
	for _, e := range list {
		if e == s {
			return true
		}
	}
	return false
}
