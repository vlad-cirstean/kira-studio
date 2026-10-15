// Package adeflow reads and writes ADE v2 workflow YAML files in <KiraSpaceHome>/workflows. It
// validates strictly (an unknown key is an error) and reports node line numbers. The Reader lists;
// writer.go edits files in place, preserving comments and key order.
package adeflow

import (
	"fmt"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
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
		return adewire.Workflow{}, &adewire.WorkflowError{Message: i18n.T("backend.space.ade.workflowEmpty.body", nil)}
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
	candidates := make(map[string]bool) // earlier steps a review may resume: prompt steps only
	var nodes []*resultNodes
	var prefixes []string
	var explicit []bool // max_returns declared on the step
	for i, stepNode := range list.Content {
		sp := fmt.Sprintf("%sstep %d: ", prefix[:len(prefix)-2]+", ", i+1)
		sm := v.fields(stepNode, sp, "id", "name", "runs_on", "before", "on_failure", "results", "max_returns", "timeout", "prompt", "allowed_tools", "smart_script", "params", "review", "sandbox")
		if v.err != nil {
			return out
		}
		step := adewire.PipelineStep{AllowedTools: make([]string, 0), Params: map[string][]string{}, Sandbox: adewire.DefaultSandbox()}
		step.ID = v.str(sm, sp, "id", true)
		if v.err == nil && !idPattern.MatchString(step.ID) {
			v.fail(sm["id"], sp, "id must be lowercase letters, digits, - or _")
		}
		if v.err == nil && earlier[step.ID] {
			v.fail(sm["id"], sp, "id %q is already used by another step in this stage", step.ID)
		}
		step.Name = v.str(sm, sp, "name", true)
		step.RunsOn = v.runsOn(sm, sp)
		step.Before = v.before(sm, sp)
		var rn *resultNodes
		if n, has := sm["results"]; has {
			if _, legacy := sm["on_failure"]; legacy {
				v.fail(n, sp, "results and on_failure cannot be used together")
			}
			rn = v.results(n, sp)
			step.Results = rn.list
		} else {
			step.OnFailure = v.onFailure(sm, sp, earlier)
			step.Results = adewire.ImplicitResults(step.ID, step.OnFailure)
		}
		step.Timeout = v.timeout(sm, sp)
		v.stepBody(sm, sp, &step, candidates)
		set := v.maxReturns(sm, sp, &step)
		if n, has := sm["sandbox"]; has && v.err == nil {
			step.Sandbox = v.sandbox(n, sp)
		}
		if v.err != nil {
			return out
		}
		earlier[step.ID] = true
		if step.SmartScript == "" && step.Review == nil {
			candidates[step.ID] = true
		}
		out = append(out, step)
		nodes = append(nodes, rn)
		prefixes = append(prefixes, sp)
		explicit = append(explicit, set)
	}
	v.resolveRoutes(out, nodes, prefixes, explicit)
	return out
}

// maxReturns reads a step's return limit into step.MaxReturns and reports whether it was declared. Absent,
// the limit is what on_failure implies, else the default; a results step may still fold a legacy result max.
func (v *validator) maxReturns(sm map[string]*yaml.Node, sp string, step *adewire.PipelineStep) bool {
	review := step.Review != nil
	n, has := sm["max_returns"]
	if !has {
		step.MaxReturns = adewire.LegacyLimit(step.OnFailure, review)
		return false
	}
	if _, legacy := sm["on_failure"]; legacy {
		v.fail(n, sp, "max_returns and on_failure cannot be used together; use results")
		return true
	}
	lo, rule := 1, "from 1 to %d"
	if review {
		lo, rule = 0, "from 0 to %d on a review step"
	}
	val, err := strconv.Atoi(n.Value)
	if n.Kind != yaml.ScalarNode || err != nil || val < lo || val > adewire.MaxMaxReturns {
		v.fail(n, sp, "max_returns must be a whole number "+rule, adewire.MaxMaxReturns)
		return true
	}
	step.MaxReturns = val
	return true
}

// before reads a step's approval gate; the default is auto.
func (v *validator) before(sm map[string]*yaml.Node, sp string) string {
	if _, has := sm["before"]; !has {
		return "auto"
	}
	b := v.str(sm, sp, "before", true)
	if v.err == nil && b != "auto" && b != "approval" {
		v.fail(sm["before"], sp, "before must be auto or approval")
	}
	return b
}

// stepBody reads what a step runs: a prompt with its allowed tools, or a smart script with its params.
func (v *validator) stepBody(sm map[string]*yaml.Node, sp string, step *adewire.PipelineStep, candidates map[string]bool) {
	if rn, review := sm["review"]; review {
		for _, key := range []string{"prompt", "allowed_tools", "smart_script", "params"} {
			if n, has := sm[key]; has {
				v.fail(n, sp, "%s is not allowed on review steps", key)
				return
			}
		}
		step.Review = v.reviewConfig(rn, sp, candidates)
		return
	}
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

const (
	maxSandboxPaths = 32
	maxSandboxPath  = 4096
)

// sandbox reads a step's sandbox block. An empty mapping is the default.
func (v *validator) sandbox(n *yaml.Node, sp string) adewire.StepSandbox {
	sb := adewire.DefaultSandbox()
	if n.Kind != yaml.MappingNode {
		v.fail(n, sp, "sandbox must be a mapping")
		return sb
	}
	m := v.fields(n, sp, "access", "read", "allow", "network")
	if v.err != nil {
		return sb
	}
	if _, has := m["access"]; has {
		sb.Access = v.str(m, sp, "access", true)
		if v.err == nil && sb.Access != adewire.SandboxWrite && sb.Access != adewire.SandboxRead && sb.Access != adewire.SandboxOff {
			v.fail(m["access"], sp, "access must be write, read or off")
		}
	}
	sb.Read = v.sandboxPaths(m, sp, "read")
	sb.Allow = v.sandboxPaths(m, sp, "allow")
	if _, has := m["network"]; has {
		sb.Network = v.boolean(m, sp, "network")
	}
	if v.err == nil && sb.Access == adewire.SandboxOff && (len(sb.Read) > 0 || len(sb.Allow) > 0 || m["network"] != nil) {
		v.fail(n, sp, "sandbox off takes no other keys")
	}
	return sb
}

// sandboxPaths reads a list of absolute or ~/ paths.
func (v *validator) sandboxPaths(m map[string]*yaml.Node, sp, key string) []string {
	out := make([]string, 0)
	n, has := m[key]
	if !has {
		return out
	}
	if n.Kind != yaml.SequenceNode {
		v.fail(n, sp, "%s must be a list of paths", key)
		return out
	}
	if len(n.Content) > maxSandboxPaths {
		v.fail(n, sp, "%s has too many entries: at most %d", key, maxSandboxPaths)
		return out
	}
	for _, e := range n.Content {
		if e.Kind != yaml.ScalarNode || e.Tag == "!!null" {
			v.fail(e, sp, "%s entries must be text", key)
			return out
		}
		switch p := e.Value; {
		case len(p) > maxSandboxPath || strings.ContainsAny(p, "\x00\r\n"):
			v.fail(e, sp, "path %q is not allowed", truncate(p, 80))
		case p != "~" && !strings.HasPrefix(p, "~/") && !strings.HasPrefix(p, "/"):
			v.fail(e, sp, "path %q must be absolute or start with ~/", p)
		case protectedSandboxPath(p):
			v.fail(e, sp, "path %q is not allowed", p)
		default:
			out = append(out, p)
		}
		if v.err != nil {
			return out
		}
	}
	return out
}

// protectedSandboxPath reports whether p is the root, the home folder or an ancestor of it, a
// folder holding Claude's config or the keychain directory, or inside the keychain directory.
func protectedSandboxPath(p string) bool {
	c := path.Clean(p)
	switch c {
	case "/", "~", "~/Library", "~/.claude", ".":
		return true
	}
	return strings.HasPrefix(c, "..") || strings.HasPrefix(c+"/", "~/Library/Keychains/") || protectedAbsoluteHome(c)
}

// protectedAbsoluteHome catches the absolute spelling of the protected paths: /Users or /home, a
// home folder under it, its Library and .claude folders, and the keychain directory.
func protectedAbsoluteHome(c string) bool {
	seg := strings.Split(strings.TrimPrefix(c, "/"), "/")
	if !strings.HasPrefix(c, "/") || (seg[0] != "Users" && seg[0] != "home") {
		return false
	}
	switch {
	case len(seg) <= 2:
		return true
	case len(seg) == 3:
		return seg[2] == "Library" || seg[2] == ".claude"
	}
	return seg[2] == "Library" && seg[3] == "Keychains"
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// reviewConfig reads a review step's block. An empty mapping takes the defaults.
func (v *validator) reviewConfig(n *yaml.Node, sp string, candidates map[string]bool) *adewire.ReviewStepConfig {
	if n.Kind != yaml.MappingNode {
		v.fail(n, sp, "review must be a mapping")
		return nil
	}
	m := v.fields(n, sp, "send_to", "implementer")
	if v.err != nil {
		return nil
	}
	cfg := &adewire.ReviewStepConfig{SendTo: adewire.ReviewSendImplementer}
	if _, has := m["send_to"]; has {
		cfg.SendTo = v.str(m, sp, "send_to", true)
		if v.err == nil && cfg.SendTo != adewire.ReviewSendImplementer && cfg.SendTo != adewire.ReviewSendNew {
			v.fail(m["send_to"], sp, "send_to must be implementer or new")
		}
	}
	if _, has := m["implementer"]; has {
		cfg.Implementer = v.str(m, sp, "implementer", true)
		if v.err == nil && !candidates[cfg.Implementer] {
			v.fail(m["implementer"], sp, "implementer must be an earlier agent step")
		}
	}
	return cfg
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

const (
	maxResults           = 12
	maxResultDescription = 200
)

// resultNodes keeps the YAML nodes of a step's declared results so routes can be checked once every
// step id of the stage is known.
type resultNodes struct {
	list []adewire.StepResult
	next []*yaml.Node
	max  []*yaml.Node
	node *yaml.Node
}

// results reads a step's results list; routes are resolved later by resolveRoutes.
func (v *validator) results(n *yaml.Node, sp string) *resultNodes {
	rn := &resultNodes{node: n, list: make([]adewire.StepResult, 0)}
	if n.Kind != yaml.SequenceNode || len(n.Content) == 0 || len(n.Content) > maxResults {
		v.fail(n, sp, "results must be a list of 1 to %d results", maxResults)
		return rn
	}
	seen := make(map[string]bool)
	for i, item := range n.Content {
		rp := fmt.Sprintf("%sresult %d: ", sp, i+1)
		m := v.fields(item, rp, "id", "ok", "description", "next", "max")
		if v.err != nil {
			return rn
		}
		r := adewire.StepResult{ID: v.str(m, rp, "id", true)}
		if v.err == nil {
			switch {
			case !idPattern.MatchString(r.ID):
				v.fail(m["id"], rp, "id must be lowercase letters, digits, - or _")
			case r.ID == "needs_input":
				v.fail(m["id"], rp, "id needs_input is reserved")
			case seen[r.ID]:
				v.fail(m["id"], rp, "id %q is already used by another result of this step", r.ID)
			}
		}
		seen[r.ID] = true
		if _, has := m["ok"]; !has {
			v.failMissing(rp, "ok")
		}
		r.OK = v.boolean(m, rp, "ok")
		r.Description = v.str(m, rp, "description", false)
		if v.err == nil && (strings.ContainsAny(r.Description, "\r\n") || utf8.RuneCountInString(r.Description) > maxResultDescription) {
			v.fail(m["description"], rp, "description must be one line of at most %d characters", maxResultDescription)
		}
		r.Next = adewire.DefaultRoute(r.OK)
		if _, has := m["next"]; has {
			r.Next = v.str(m, rp, "next", true)
		}
		if v.err != nil {
			return rn
		}
		rn.list = append(rn.list, r)
		rn.next = append(rn.next, m["next"])
		rn.max = append(rn.max, m["max"])
	}
	return rn
}

// resolveRoutes checks every declared result's route against the stage's step ids and fills the loop
// budget. Steps without declared results (nil entries) were derived from on_failure and are already valid.
func (v *validator) resolveRoutes(steps []adewire.PipelineStep, nodes []*resultNodes, prefixes []string, explicit []bool) {
	if v.err != nil {
		return
	}
	index := make(map[string]int, len(steps))
	for i, s := range steps {
		index[s.ID] = i
	}
	for si, rn := range nodes {
		if rn == nil {
			continue
		}
		if !v.resolveStepRoutes(steps, index, si, rn, prefixes[si], explicit[si]) {
			return
		}
	}
}

// resolveStepRoutes resolves one step's results; false means a violation was recorded.
func (v *validator) resolveStepRoutes(steps []adewire.PipelineStep, index map[string]int, si int, rn *resultNodes, sp string, explicit bool) bool {
	forward := false
	legacy := 0 // largest result max declared on a loop route (a file from before max_returns)
	for ri := range rn.list {
		r := &rn.list[ri]
		rp := fmt.Sprintf("%sresult %d: ", sp, ri+1)
		node := cmpNode(rn.next[ri], rn.node)
		loop := false
		switch r.Next {
		case adewire.RouteNext, adewire.RouteEnd:
		case adewire.RouteStop:
			if r.OK {
				v.fail(node, rp, "stop is only allowed on a result that is not ok")
				return false
			}
		default:
			target, known := index[r.Next]
			if !known {
				v.fail(node, rp, "next must be next, end, stop or a step id of this stage")
				return false
			}
			loop = target <= si
		}
		forward = forward || !loop
		r.Loop = loop
		m, ok := v.legacyMax(rn.max[ri], rp, loop, explicit)
		if !ok {
			return false
		}
		legacy = max(legacy, m)
	}
	if !forward {
		v.fail(rn.node, sp, "at least one result must lead forward, or the stage can never finish")
		return false
	}
	review := steps[si].Review != nil
	if !explicit {
		steps[si].MaxReturns = adewire.DefaultLimit(review)
		if legacy > 0 {
			steps[si].MaxReturns = legacy
		}
	}
	if rule, ok := adewire.LegacyOnFailure(steps[si].ID, rn.list, stepIDs(steps[:si]), steps[si].MaxReturns, review); ok {
		steps[si].OnFailure = rule
	}
	steps[si].Results = rn.list
	return true
}

// legacyMax reads a result's max, a budget from before max_returns: only on a loop route, and not beside
// the step's max_returns. It returns 0 when none is declared.
func (v *validator) legacyMax(node *yaml.Node, prefix string, loop, explicit bool) (int, bool) {
	switch {
	case node == nil:
		return 0, true
	case !loop:
		v.fail(node, prefix, "max is only allowed on a route back to this step or an earlier one")
		return 0, false
	case explicit:
		v.fail(node, prefix, "max moved to max_returns on the step; remove it")
		return 0, false
	}
	n, err := strconv.Atoi(node.Value)
	if node.Kind != yaml.ScalarNode || err != nil || n < 1 || n > adewire.MaxMaxReturns {
		v.fail(node, prefix, "max must be a whole number from 1 to %d", adewire.MaxMaxReturns)
		return 0, false
	}
	return n, true
}

func cmpNode(n, fallback *yaml.Node) *yaml.Node {
	if n != nil {
		return n
	}
	return fallback
}

func stepIDs(steps []adewire.PipelineStep) []string {
	out := make([]string, len(steps))
	for i, s := range steps {
		out[i] = s.ID
	}
	return out
}
