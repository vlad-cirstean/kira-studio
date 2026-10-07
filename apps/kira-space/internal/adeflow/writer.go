package adeflow

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

// ErrInvalid marks a caller mistake: a bad file name, an invalid workflow, a YAML syntax error in
// the file being edited. The ade engine maps it to E_INVALID.
var ErrInvalid = errors.New("adeflow: invalid")

func invalidf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

const maxYamlBytes = 1 << 20

var fileNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*\.yaml$`)

// ValidateYaml parses src exactly as the reader does; exactly one of the result fields is set.
func ValidateYaml(src string) adewire.WorkflowValidation {
	wf, werr := Parse([]byte(src))
	if werr != nil {
		return adewire.WorkflowValidation{Error: werr}
	}
	return adewire.WorkflowValidation{Workflow: &wf}
}

func (r *Reader) path(file string) (string, error) {
	if !fileNamePattern.MatchString(file) {
		return "", invalidf("file name %q must be lowercase letters, digits, - or _ and end in .yaml", file)
	}
	return filepath.Join(r.Dir, file), nil
}

// ReadYaml returns one workflow file's raw text.
func (r *Reader) ReadYaml(file string) (adewire.WorkflowYaml, error) {
	p, err := r.path(file)
	if err != nil {
		return adewire.WorkflowYaml{}, err
	}
	src, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return adewire.WorkflowYaml{}, invalidf("workflow %s does not exist", file)
		}
		return adewire.WorkflowYaml{}, fmt.Errorf("adeflow: read %s: %w", file, err)
	}
	return adewire.WorkflowYaml{FileName: file, Path: p, Yaml: string(src)}, nil
}

// SaveYaml writes src as the file's content, valid or not: the user's text is never refused, and
// the last valid version stays in use while the file is broken.
func (r *Reader) SaveYaml(file, src string) (adewire.WorkflowEntry, error) {
	p, err := r.path(file)
	if err != nil {
		return adewire.WorkflowEntry{}, err
	}
	if len(src) > maxYamlBytes {
		return adewire.WorkflowEntry{}, invalidf("the workflow file is larger than 1 MiB")
	}
	r.wmu.Lock()
	defer r.wmu.Unlock()
	if err := writeAtomic(r.Dir, file, []byte(src)); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	return r.entry(file, p)
}

// Save rewrites the file from the structured workflow, keeping comments, key order and the user's
// scalar styles wherever the content is unchanged. wf.ID must equal the file name stem.
func (r *Reader) Save(file string, wf adewire.Workflow) (adewire.WorkflowEntry, error) {
	p, err := r.path(file)
	if err != nil {
		return adewire.WorkflowEntry{}, err
	}
	if wf.ID != strings.TrimSuffix(file, ".yaml") {
		return adewire.WorkflowEntry{}, invalidf("id must equal the file name without .yaml")
	}
	r.wmu.Lock()
	defer r.wmu.Unlock()
	var doc yaml.Node
	switch src, err := os.ReadFile(p); {
	case err == nil:
		if err := yaml.Unmarshal(src, &doc); err != nil {
			return adewire.WorkflowEntry{}, invalidf("fix the YAML error on line %d first", yamlErrLineOf(err))
		}
	case !os.IsNotExist(err):
		return adewire.WorkflowEntry{}, fmt.Errorf("adeflow: read %s: %w", file, err)
	}
	out, err := encodeWorkflow(&doc, wf)
	if err != nil {
		return adewire.WorkflowEntry{}, err
	}
	if err := writeAtomic(r.Dir, file, out); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	return r.entry(file, p)
}

// Import copies a workflow file from anywhere into the workflows dir. The target is <id>.yaml, or
// the sanitized source base name when the source does not parse. An existing target is refused.
func (r *Reader) Import(srcPath string) (adewire.WorkflowEntry, error) {
	if !filepath.IsAbs(srcPath) {
		return adewire.WorkflowEntry{}, invalidf("path must be absolute")
	}
	info, err := os.Stat(srcPath)
	if err != nil || !info.Mode().IsRegular() {
		return adewire.WorkflowEntry{}, invalidf("%s is not a readable file", srcPath)
	}
	if info.Size() > maxYamlBytes {
		return adewire.WorkflowEntry{}, invalidf("the workflow file is larger than 1 MiB")
	}
	src, err := os.ReadFile(srcPath)
	if err != nil {
		return adewire.WorkflowEntry{}, invalidf("cannot read %s: %v", srcPath, err)
	}
	stem := ""
	if wf, werr := Parse(src); werr == nil {
		stem = wf.ID
	} else {
		stem = slug(strings.TrimSuffix(filepath.Base(srcPath), filepath.Ext(srcPath)), "workflow")
	}
	file := stem + ".yaml"
	r.wmu.Lock()
	defer r.wmu.Unlock()
	p := filepath.Join(r.Dir, file)
	if _, err := os.Lstat(p); err == nil {
		return adewire.WorkflowEntry{}, invalidf("%s already exists in the workflows folder", file)
	}
	if err := writeAtomic(r.Dir, file, src); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	return r.entry(file, p)
}

// New creates a minimal valid one-stage user workflow named name. The file name is the slug of the
// name, suffixed -2, -3 ... when taken.
func (r *Reader) New(name string) (adewire.WorkflowEntry, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 || strings.ContainsAny(name, "\r\n") {
		return adewire.WorkflowEntry{}, invalidf("name must be 1 to 80 characters on one line")
	}
	base := slug(name, "workflow")
	r.wmu.Lock()
	defer r.wmu.Unlock()
	id := base
	for n := 2; ; n++ {
		if _, err := os.Lstat(filepath.Join(r.Dir, id+".yaml")); os.IsNotExist(err) {
			break
		}
		id = fmt.Sprintf("%s-%d", base, n)
	}
	wf := adewire.Workflow{ID: id, Name: name, Stages: []adewire.Stage{
		{ID: "work", Name: "Work", Kind: "user", Status: "In progress", Steps: []adewire.PipelineStep{}},
	}}
	out, err := encodeWorkflow(&yaml.Node{}, wf)
	if err != nil {
		return adewire.WorkflowEntry{}, err
	}
	file := id + ".yaml"
	if err := writeAtomic(r.Dir, file, out); err != nil {
		return adewire.WorkflowEntry{}, err
	}
	return r.entry(file, filepath.Join(r.Dir, file))
}

func (r *Reader) entry(file, path string) (adewire.WorkflowEntry, error) {
	for _, e := range r.List(nil).Workflows {
		if e.FileName == file {
			return e, nil
		}
	}
	return adewire.WorkflowEntry{}, fmt.Errorf("adeflow: %s vanished after write", path)
}

var slugStrip = regexp.MustCompile(`[^a-z0-9]+`)

// slug lowercases s to the idPattern alphabet; fallback when nothing is left.
func slug(s, fallback string) string {
	out := strings.Trim(slugStrip.ReplaceAllString(strings.ToLower(s), "-"), "-")
	if len(out) > 60 {
		out = strings.Trim(out[:60], "-")
	}
	if out == "" {
		return fallback
	}
	return out
}

func yamlErrLineOf(err error) int {
	if m := yamlErrLine.FindStringSubmatch(err.Error()); m != nil {
		n := 0
		fmt.Sscanf(m[1], "%d", &n)
		return n
	}
	return 0
}

// writeAtomic writes data to dir/file through a hidden temp file in the same dir and a rename. The
// dir is created on first write (never seeded); the reader and the watcher ignore the temp file.
func writeAtomic(dir, file string, data []byte) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("adeflow: create %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+file+".tmp-*")
	if err != nil {
		return fmt.Errorf("adeflow: temp file: %w", err)
	}
	name := tmp.Name()
	fail := func(err error) error {
		tmp.Close()
		os.Remove(name)
		return fmt.Errorf("adeflow: write %s: %w", file, err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return fmt.Errorf("adeflow: write %s: %w", file, err)
	}
	if err := os.Chmod(name, 0o644); err != nil {
		os.Remove(name)
		return fmt.Errorf("adeflow: write %s: %w", file, err)
	}
	if err := os.Rename(name, filepath.Join(dir, file)); err != nil {
		os.Remove(name)
		return fmt.Errorf("adeflow: write %s: %w", file, err)
	}
	return nil
}

// encodeWorkflow applies wf onto doc (zero value = new document), encodes it and re-parses the
// bytes; a result that does not parse is refused.
func encodeWorkflow(doc *yaml.Node, wf adewire.Workflow) ([]byte, error) {
	if doc.Kind == 0 || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		*doc = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode, Tag: "!!map"}}}
	}
	applyWorkflow(doc.Content[0], wf)
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(doc); err != nil {
		return nil, fmt.Errorf("adeflow: encode workflow: %w", err)
	}
	if err := enc.Close(); err != nil {
		return nil, fmt.Errorf("adeflow: encode workflow: %w", err)
	}
	if _, werr := Parse(buf.Bytes()); werr != nil {
		if werr.Line > 0 {
			return nil, invalidf("%s (line %d)", werr.Message, werr.Line)
		}
		return nil, invalidf("%s", werr.Message)
	}
	return buf.Bytes(), nil
}

// --- yaml.Node editing ---------------------------------------------------------------------------

type scalarKind int

const (
	kText scalarKind = iota
	kBlock
	kBool
)

var (
	topOrder   = []string{"id", "name", "stages"}
	stageOrder = []string{"id", "name", "kind", "status", "skip", "session", "prompt", "steps", "command", "runs_on", "on_failure", "timeout"}
	stepOrder  = []string{"id", "name", "runs_on", "before", "on_failure", "timeout", "prompt", "allowed_tools"}
)

func find(m *yaml.Node, key string) (int, *yaml.Node) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return i, m.Content[i+1]
		}
	}
	return -1, nil
}

// put sets key to v, replacing in place or inserting after the nearest preceding key of order.
func put(m *yaml.Node, key string, v *yaml.Node, order []string) {
	if i, _ := find(m, key); i >= 0 {
		m.Content[i+1] = v
		return
	}
	at := 0
	for _, k := range order {
		if k == key {
			break
		}
		if i, _ := find(m, k); i >= 0 {
			at = i + 2
		}
	}
	kn := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	m.Content = append(m.Content, nil, nil)
	copy(m.Content[at+2:], m.Content[at:])
	m.Content[at], m.Content[at+1] = kn, v
}

func newScalar(kind scalarKind, want string) *yaml.Node {
	switch kind {
	case kBool:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: want}
	case kBlock:
		if strings.Contains(want, "\n") {
			return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Style: yaml.LiteralStyle, Value: want + "\n"}
		}
	}
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: want}
}

func sameScalar(kind scalarKind, n *yaml.Node, want string) bool {
	if n.Kind != yaml.ScalarNode {
		return false
	}
	switch kind {
	case kBlock:
		return strings.TrimRight(n.Value, "\n") == want
	case kBool:
		return n.Value == want
	}
	return strings.TrimSpace(n.Value) == want
}

// setScalar updates key to want, leaving an equal node untouched (comments and style survive).
// add=false skips a missing key (a default value the file never spelled out).
func setScalar(m *yaml.Node, key string, kind scalarKind, want string, add bool, order []string) {
	_, n := find(m, key)
	switch {
	case n == nil:
		if add {
			put(m, key, newScalar(kind, want), order)
		}
	case sameScalar(kind, n, want):
	case n.Kind != yaml.ScalarNode:
		put(m, key, newScalar(kind, want), order)
	default:
		fresh := newScalar(kind, want)
		keepQuote := n.Style&(yaml.DoubleQuotedStyle|yaml.SingleQuotedStyle) != 0 && fresh.Style == 0 && kind != kBool
		wasBlock := n.Style&(yaml.LiteralStyle|yaml.FoldedStyle) != 0
		n.Value, n.Tag, n.Alias = fresh.Value, fresh.Tag, nil
		switch {
		case fresh.Style != 0:
			n.Style = fresh.Style
		case kind == kBlock && wasBlock:
			n.Style, n.Value = yaml.LiteralStyle, want+"\n"
		case keepQuote:
		default:
			n.Style = 0
		}
	}
}

func scalarList(vals []string) *yaml.Node {
	seq := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	if len(vals) == 0 {
		seq.Style = yaml.FlowStyle
	}
	for _, v := range vals {
		seq.Content = append(seq.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: v})
	}
	return seq
}

func setList(m *yaml.Node, key string, vals []string, order []string) {
	_, n := find(m, key)
	if n == nil {
		if len(vals) > 0 {
			put(m, key, scalarList(vals), order)
		}
		return
	}
	if n.Kind == yaml.SequenceNode && len(n.Content) == len(vals) {
		same := true
		for i, c := range n.Content {
			if c.Kind != yaml.ScalarNode || c.Value != vals[i] {
				same = false
			}
		}
		if same {
			return
		}
	}
	put(m, key, scalarList(vals), order)
}

func itemID(n *yaml.Node) string {
	if n.Kind != yaml.MappingNode {
		return ""
	}
	if _, v := find(n, "id"); v != nil {
		return strings.TrimSpace(v.Value)
	}
	return ""
}

// syncItems returns the sequence content for ids: existing nodes matched by id, in ids order, with
// fresh mappings for new ids. apply fills each.
func syncItems(old *yaml.Node, ids []string, apply func(i int, item *yaml.Node)) *yaml.Node {
	seq := old
	var existing []*yaml.Node
	if seq != nil && seq.Kind == yaml.SequenceNode {
		existing = seq.Content
	} else {
		seq = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	}
	used := make([]bool, len(existing))
	content := make([]*yaml.Node, 0, len(ids))
	for i, id := range ids {
		var item *yaml.Node
		for j, e := range existing {
			if !used[j] && itemID(e) == id {
				used[j], item = true, e
				break
			}
		}
		if item == nil {
			item = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		}
		apply(i, item)
		content = append(content, item)
	}
	seq.Content = content
	return seq
}

func applyWorkflow(root *yaml.Node, wf adewire.Workflow) {
	setScalar(root, "id", kText, wf.ID, true, topOrder)
	setScalar(root, "name", kText, wf.Name, true, topOrder)
	ids := make([]string, len(wf.Stages))
	for i, s := range wf.Stages {
		ids[i] = s.ID
	}
	_, old := find(root, "stages")
	put(root, "stages", syncItems(old, ids, func(i int, item *yaml.Node) { applyStage(item, wf.Stages[i]) }), topOrder)
}

func applyStage(m *yaml.Node, st adewire.Stage) {
	setScalar(m, "id", kText, st.ID, true, stageOrder)
	setScalar(m, "name", kText, st.Name, true, stageOrder)
	if _, k := find(m, "kind"); k == nil || k.Kind != yaml.ScalarNode || stageKindAlias[strings.TrimSpace(k.Value)] != st.Kind {
		setScalar(m, "kind", kText, st.Kind, true, stageOrder)
	}
	setScalar(m, "status", kText, st.Status, true, stageOrder)
	keep := map[string]bool{"id": true, "name": true, "kind": true, "status": true}
	if st.Skip {
		keep["skip"] = true
		setScalar(m, "skip", kBool, "true", true, stageOrder)
	}
	switch st.Kind {
	case "user":
		keep["session"] = true
		setScalar(m, "session", kBool, fmt.Sprint(st.Session), st.Session, stageOrder)
		if st.Session && st.Prompt != "" {
			keep["prompt"] = true
			setScalar(m, "prompt", kBlock, st.Prompt, true, stageOrder)
		}
	case "agent":
		keep["steps"] = true
		ids := make([]string, len(st.Steps))
		for i, s := range st.Steps {
			ids[i] = s.ID
		}
		_, old := find(m, "steps")
		put(m, "steps", syncItems(old, ids, func(i int, item *yaml.Node) { applyStep(item, st.Steps[i]) }), stageOrder)
	case "script":
		for _, k := range []string{"command", "runs_on", "on_failure", "timeout"} {
			keep[k] = true
		}
		setScalar(m, "command", kBlock, st.Command, true, stageOrder)
		setScalar(m, "runs_on", kText, st.RunsOn, true, stageOrder)
		setScalar(m, "on_failure", kText, defaultStr(st.OnFailure, "stop"), st.OnFailure != "" && st.OnFailure != "stop", stageOrder)
		setScalar(m, "timeout", kText, st.Timeout, true, stageOrder)
	}
	dropOthers(m, keep)
}

func applyStep(m *yaml.Node, s adewire.PipelineStep) {
	setScalar(m, "id", kText, s.ID, true, stepOrder)
	setScalar(m, "name", kText, s.Name, true, stepOrder)
	setScalar(m, "runs_on", kText, s.RunsOn, true, stepOrder)
	setScalar(m, "before", kText, defaultStr(s.Before, "auto"), s.Before != "" && s.Before != "auto", stepOrder)
	setScalar(m, "on_failure", kText, defaultStr(s.OnFailure, "stop"), s.OnFailure != "" && s.OnFailure != "stop", stepOrder)
	setScalar(m, "timeout", kText, s.Timeout, true, stepOrder)
	setScalar(m, "prompt", kBlock, s.Prompt, true, stepOrder)
	setList(m, "allowed_tools", s.AllowedTools, stepOrder)
}

func defaultStr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// dropOthers removes keys a stage of this kind does not allow (a kind change leaves them behind).
func dropOthers(m *yaml.Node, keep map[string]bool) {
	for i := 0; i+1 < len(m.Content); {
		if keep[m.Content[i].Value] {
			i += 2
			continue
		}
		m.Content = append(m.Content[:i], m.Content[i+2:]...)
	}
}
