package adeflow

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const samplesDir = "../../../../docs/v2.0/design/ade-v2/workflows"

func TestParse_designSamples(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(samplesDir, "*.yaml"))
	if err != nil || len(files) != 3 {
		t.Fatalf("samples: %v %v", files, err)
	}
	for _, f := range files {
		src, _ := os.ReadFile(f)
		wf, werr := Parse(src)
		if werr != nil {
			t.Fatalf("%s: %+v", f, werr)
		}
		if wf.ID != strings.TrimSuffix(filepath.Base(f), ".yaml") {
			t.Fatalf("%s: id %q", f, wf.ID)
		}
	}
}

const head = "id: w\nname: W\nstages:\n"

const agent = "  - id: a\n    name: A\n    kind: agent\n    status: In progress\n    steps:\n"

func step(id, extra string) string {
	return "      - id: " + id + "\n        name: S\n        runs_on: each repo\n        timeout: 1h\n        prompt: go\n" + extra
}

func smartStep(id, extra string) string {
	return "      - id: " + id + "\n        name: S\n        runs_on: each repo\n        timeout: 1h\n        smart_script: Summarize\n" + extra
}

func TestParse_rules(t *testing.T) {
	cases := []struct {
		name string
		src  string
		line int    // 0 = not asserted unless wantLine
		msg  string // substring; "" = valid
	}{
		{"valid minimal user", head + "  - id: u\n    name: U\n    kind: user\n    status: To do\n", 0, ""},
		{"alias manual", head + "  - id: u\n    name: U\n    kind: manual\n    status: To do\n", 0, ""},
		{"alias automated", head + agent + step("s", ""), 0, ""},
		{"bad kind", head + "  - id: u\n    name: U\n    kind: robot\n    status: To do\n", 6, "stage 1: kind must be user, agent or script"},
		{"bad status", head + "  - id: u\n    name: U\n    kind: user\n    status: Wip\n", 0, "stage 1: status must be"},
		{"unknown top key", "id: w\nname: W\nbogus: 1\nstages: []\n", 3, "unknown key"},
		{"empty stages", "id: w\nname: W\nstages: []\n", 3, "stages must be a non-empty list"},
		{"missing name", "id: w\nstages:\n  - id: u\n", 0, "name is required"},
		{"bad id", "id: W!\nname: W\nstages: []\n", 1, "id must be lowercase"},
		{"dup stage id", head + "  - id: u\n    name: U\n    kind: user\n    status: To do\n  - id: u\n    name: U\n    kind: user\n    status: To do\n", 8, "stage 2: id \"u\" is already used"},
		{"user session prompt optional", head + "  - id: u\n    name: U\n    kind: user\n    status: To do\n    session: true\n", 0, ""},
		{"user prompt without session", head + "  - id: u\n    name: U\n    kind: user\n    status: To do\n    prompt: x\n", 0, "prompt is not allowed on user stages"},
		{"user refuses steps", head + "  - id: u\n    name: U\n    kind: user\n    status: To do\n    timeout: 1h\n", 0, "timeout is not allowed on user stages"},
		{"agent empty steps", head + agent + "      []\n", 0, "steps must be a non-empty list"},
		{"agent refuses command", head + agent + step("s", "") + "    command: x\n", 0, "command is not allowed on agent stages"},
		{"step id may equal stage id", head + agent + step("a", ""), 0, ""},
		{"dup step id", head + agent + step("s", "") + step("s", ""), 0, "stage 1, step 2: id \"s\" is already used"},
		{"runs_on only", head + agent + strings.Replace(step("s", ""), "each repo", "only api", 1), 0, ""},
		{"runs_on only empty", head + agent + strings.Replace(step("s", ""), "each repo", "only ", 1), 0, "runs_on must be"},
		{"runs_on bad", head + agent + strings.Replace(step("s", ""), "each repo", "twice", 1), 0, "runs_on must be"},
		{"before bad", head + agent + step("s", "        before: maybe\n"), 0, "before must be auto or approval"},
		{"retry 2", head + agent + step("s", "        on_failure: retry 2\n"), 0, ""},
		{"retry 3", head + agent + step("s", "        on_failure: retry 3\n"), 0, "on_failure must be"},
		{"back earlier", head + agent + step("s", "") + step("t", "        on_failure: back:s\n"), 0, ""},
		{"back same step", head + agent + step("s", "        on_failure: back:s\n"), 0, "back: must name an earlier step"},
		{"back later step", head + agent + step("s", "        on_failure: back:t\n") + step("t", ""), 0, "back: must name an earlier step"},
		{"back other stage", head + agent + step("s", "") + "  - id: b\n    name: B\n    kind: agent\n    status: In progress\n    steps:\n" + step("t", "        on_failure: back:s\n"), 0, "stage 2, step 1: back: must name"},
		{"timeout zero", head + agent + strings.Replace(step("s", ""), "1h", "0s", 1), 0, "timeout must be"},
		{"timeout over 24h", head + agent + strings.Replace(step("s", ""), "1h", "25h", 1), 0, "timeout must be"},
		{"timeout garbage", head + agent + strings.Replace(step("s", ""), "1h", "soon", 1), 0, "timeout must be"},
		{"timeout required", head + agent + "      - id: s\n        name: S\n        runs_on: once\n        prompt: go\n", 0, "timeout is required"},
		{"allowed tools ok", head + agent + step("s", "        allowed_tools:\n          - Bash(git *)\n          - Read\n          - mcp__srv__tool\n"), 0, ""},
		{"allowed tools dup", head + agent + step("s", "        allowed_tools:\n          - Read\n          - Read\n"), 0, "listed twice"},
		{"allowed tools bad", head + agent + step("s", "        allowed_tools:\n          - \"bad tool\"\n"), 0, "not a tool pattern"},
		{"smart step", head + agent + smartStep("s", "        params:\n          lang: go\n          dirs: [a, b]\n"), 0, ""},
		{"smart step no params", head + agent + smartStep("s", ""), 0, ""},
		{"smart prompt refused", head + agent + smartStep("s", "        prompt: go\n"), 0, "prompt is not allowed with smart_script"},
		{"smart tools refused", head + agent + smartStep("s", "        allowed_tools: [Read]\n"), 0, "allowed_tools is not allowed with smart_script"},
		{"params alone", head + agent + step("s", "        params:\n          a: b\n"), 0, "params is only allowed with smart_script"},
		{"smart param name", head + agent + smartStep("s", "        params:\n          Bad-Name: x\n"), 0, "param name"},
		{"smart param nested", head + agent + smartStep("s", "        params:\n          a:\n            b: c\n"), 0, "must be text or a list of text"},
		{"script ok", head + "  - id: r\n    name: R\n    kind: script\n    status: In review\n    runs_on: once\n    timeout: 5m\n    command: make\n", 0, ""},
		{"script back", head + "  - id: r\n    name: R\n    kind: script\n    status: In review\n    runs_on: once\n    timeout: 5m\n    command: make\n    on_failure: back:x\n", 0, "back: is only allowed on an agent step"},
		{"script needs command", head + "  - id: r\n    name: R\n    kind: script\n    status: In review\n    runs_on: once\n    timeout: 5m\n", 0, "command is required"},
		{"script refuses prompt", head + "  - id: r\n    name: R\n    kind: script\n    status: In review\n    runs_on: once\n    timeout: 5m\n    command: x\n    prompt: y\n", 0, "prompt is not allowed on script stages"},
		{"syntax error", "id: w\n  name: [\n", 0, "unexpected content here (check the indentation)"},
		{"empty file", "", 0, "empty"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, werr := Parse([]byte(c.src))
			if c.msg == "" {
				if werr != nil {
					t.Fatalf("want valid, got %+v", werr)
				}
				return
			}
			if werr == nil {
				t.Fatalf("want error %q, got valid", c.msg)
			}
			if !strings.Contains(werr.Message, c.msg) {
				t.Fatalf("message %q lacks %q", werr.Message, c.msg)
			}
			if c.line != 0 && werr.Line != c.line {
				t.Fatalf("line %d, want %d (%q)", werr.Line, c.line, werr.Message)
			}
		})
	}
}

func TestParse_aliasMapsToWireKind(t *testing.T) {
	wf, werr := Parse([]byte(head + "  - id: u\n    name: U\n    kind: manual\n    status: To do\n"))
	if werr != nil || wf.Stages[0].Kind != "user" {
		t.Fatalf("%+v %+v", wf, werr)
	}
}

type memStore struct{ m map[string]string }

func (s *memStore) LastValid() (map[string]string, error) { return s.m, nil }
func (s *memStore) RecordLastValid(f, js string, _ int64) error {
	s.m[f] = js
	return nil
}

func TestReader_lastValidSurvivesBreakage(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workflows")
	store := &memStore{m: map[string]string{}}
	r := &Reader{Dir: dir, Store: store}
	if got := r.List(nil); len(got.Workflows) != 0 || got.Dir != dir {
		t.Fatalf("missing dir: %+v", got)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("reader created the dir")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	good := head + "  - id: u\n    name: U\n    kind: user\n    status: To do\n"
	path := filepath.Join(dir, "w.yaml")
	os.WriteFile(path, []byte(good), 0o644)
	os.WriteFile(filepath.Join(dir, "ignored.yml"), []byte(good), 0o644)
	got := r.List(func(id string) int { return 2 })
	if len(got.Workflows) != 1 || got.Workflows[0].Workflow == nil || got.Workflows[0].UsedBy != 2 || got.Workflows[0].Error != nil {
		t.Fatalf("%+v", got)
	}
	os.WriteFile(path, []byte(good+"    bogus: 1\n"), 0o644)
	got = r.List(nil)
	e := got.Workflows[0]
	if e.Error == nil || e.Workflow == nil || e.Workflow.ID != "w" {
		t.Fatalf("broken file lost last valid: %+v", e)
	}
	os.WriteFile(filepath.Join(dir, "x.yaml"), []byte(good), 0o644) // id w != stem x
	for _, e := range r.List(nil).Workflows {
		if e.FileName == "x.yaml" && e.Error == nil {
			t.Fatal("id/stem mismatch accepted")
		}
	}
	if _, ok := r.Get("w"); !ok {
		t.Fatal("Get w")
	}
}
