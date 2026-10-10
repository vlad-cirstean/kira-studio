package adeflow

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

func newReader(t *testing.T) *Reader {
	t.Helper()
	return &Reader{Dir: filepath.Join(t.TempDir(), "workflows"), Store: &memStore{m: map[string]string{}}, Now: time.Now}
}

// seed copies a design sample into the reader's dir with comments added.
func seed(t *testing.T, r *Reader, name string) string {
	t.Helper()
	src, err := os.ReadFile(filepath.Join(samplesDir, name))
	if err != nil {
		t.Fatal(err)
	}
	text := "# my workflow\n" + strings.Replace(string(src), "stages:\n", "stages:\n  # stage list\n", 1)
	text = strings.Replace(text, "    kind: agent\n", "    kind: automated # alias stays\n", 1)
	text = strings.Replace(text, "        timeout: 2h\n", "        timeout: 2h # long\n", 1)
	if _, err := r.SaveYaml(name, text); err != nil {
		t.Fatal(err)
	}
	return text
}

func load(t *testing.T, r *Reader, name string) adewire.Workflow {
	t.Helper()
	for _, e := range r.List(nil).Workflows {
		if e.FileName == name {
			if e.Error != nil || e.Workflow == nil {
				t.Fatalf("%s: %+v", name, e.Error)
			}
			return *e.Workflow
		}
	}
	t.Fatalf("%s not listed", name)
	return adewire.Workflow{}
}

func read(t *testing.T, r *Reader, name string) string {
	t.Helper()
	y, err := r.ReadYaml(name)
	if err != nil {
		t.Fatal(err)
	}
	return y.Yaml
}

func saveOK(t *testing.T, r *Reader, name string, wf adewire.Workflow) string {
	t.Helper()
	if _, err := r.Save(name, wf); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got := load(t, r, name); !reflect.DeepEqual(got, wf) {
		t.Fatalf("re-parse differs:\n got %+v\nwant %+v", got, wf)
	}
	return read(t, r, name)
}

func TestSave_preservesCommentsAndStyle(t *testing.T) {
	for _, name := range []string{"standard.yaml", "bugfix.yaml", "chore.yaml"} {
		r := newReader(t)
		orig := seed(t, r, name)
		wf := load(t, r, name)
		out := saveOK(t, r, name, wf)
		for _, want := range []string{"# my workflow", "# stage list", "# alias stays", "kind: automated"} {
			if strings.Contains(orig, want) && !strings.Contains(out, want) {
				t.Errorf("%s: lost %q", name, want)
			}
		}
		if strings.Contains(orig, "# long") && !strings.Contains(out, "# long") {
			t.Errorf("%s: lost # long", name)
		}
		if strings.Contains(orig, `"back:impl"`) && !strings.Contains(out, `"back:impl"`) {
			t.Errorf("%s: quote style changed", name)
		}
		if out != orig {
			t.Errorf("%s: unchanged save altered the file:\n%s", name, out)
		}
	}
}

func TestSave_edits(t *testing.T) {
	r := newReader(t)
	seed(t, r, "standard.yaml")
	base := load(t, r, "standard.yaml")

	t.Run("edit scalar keeps comment", func(t *testing.T) {
		wf := base
		wf.Stages = append([]adewire.Stage(nil), base.Stages...)
		impl := wf.Stages[1]
		impl.Steps = append([]adewire.PipelineStep(nil), impl.Steps...)
		impl.Steps[1].Timeout = "3h"
		wf.Stages[1] = impl
		out := saveOK(t, r, "standard.yaml", wf)
		if !strings.Contains(out, "timeout: 3h # long") {
			t.Fatalf("comment lost:\n%s", out)
		}
	})

	t.Run("reorder stages, delete and add step, defaults not added", func(t *testing.T) {
		wf := load(t, r, "standard.yaml")
		wf.Stages = []adewire.Stage{wf.Stages[2], wf.Stages[0], wf.Stages[1], wf.Stages[3]}
		steps := wf.Stages[2].Steps
		wf.Stages[2].Steps = append(append([]adewire.PipelineStep(nil), steps[:2]...), steps[3:]...)
		wf.Stages[2].Steps = append(wf.Stages[2].Steps, adewire.PipelineStep{
			ID: "lint", Name: "Lint", RunsOn: "once", Before: "auto", OnFailure: "stop", Timeout: "10m",
			Prompt: "Run lint.\nFix it.", AllowedTools: []string{"Bash(git *)"}, Params: map[string][]string{},
		})
		out := saveOK(t, r, "standard.yaml", wf)
		if strings.Index(out, "id: review") > strings.Index(out, "id: spec") {
			t.Fatalf("stages not reordered:\n%s", out)
		}
		_, tail, _ := strings.Cut(out, "id: lint")
		step, _, _ := strings.Cut(tail, "prompt:")
		if strings.Contains(step, "before:") || strings.Contains(step, "on_failure:") {
			t.Fatalf("default keys written for a new step:\n%s", tail)
		}
		if !strings.Contains(tail, "prompt: |") || !strings.Contains(tail, "allowed_tools:") {
			t.Fatalf("new step shape:\n%s", tail)
		}
		if strings.Contains(out, "id: tests") {
			t.Fatalf("deleted step still present")
		}
	})

	t.Run("interactive user stage with no prompt writes no prompt key", func(t *testing.T) {
		wf := load(t, r, "standard.yaml")
		for i := range wf.Stages {
			if wf.Stages[i].ID == "spec" {
				wf.Stages[i] = adewire.Stage{ID: "spec", Name: "Spec", Kind: "user", Status: "To do", Session: true, Steps: []adewire.PipelineStep{}}
			}
		}
		out := saveOK(t, r, "standard.yaml", wf)
		_, seg, _ := strings.Cut(out, "id: spec")
		seg, _, _ = strings.Cut(seg, "- id:")
		if !strings.Contains(seg, "session: true") || strings.Contains(seg, "prompt:") {
			t.Fatalf("spec stage:\n%s", seg)
		}
	})

	t.Run("smart step keeps key order and params shape", func(t *testing.T) {
		wf := load(t, r, "standard.yaml")
		impl := slices.IndexFunc(wf.Stages, func(s adewire.Stage) bool { return s.ID == "impl" })
		wf.Stages[impl].Steps = append([]adewire.PipelineStep(nil), wf.Stages[impl].Steps...)
		wf.Stages[impl].Steps[0] = adewire.PipelineStep{
			ID: wf.Stages[impl].Steps[0].ID, Name: "Smart", RunsOn: "once", Before: "auto", OnFailure: "stop", Timeout: "10m", AllowedTools: []string{}, SmartScript: "Summarize",
			Params: map[string][]string{"lang": {"go"}, "dirs": {"a", "b"}},
		}
		out := saveOK(t, r, "standard.yaml", wf)
		_, seg, _ := strings.Cut(out, "name: Smart")
		seg, _, _ = strings.Cut(seg, "- id:")
		order := []string{"runs_on:", "timeout:", "smart_script: Summarize", "params:", "dirs:", "lang: go"}
		at := 0
		for _, k := range order {
			i := strings.Index(seg[at:], k)
			if i < 0 {
				t.Fatalf("%q missing or out of order:\n%s", k, seg)
			}
			at += i
		}
		if strings.Contains(seg, "prompt:") || strings.Contains(seg, "allowed_tools:") {
			t.Fatalf("prompt keys left on a smart step:\n%s", seg)
		}
		back := load(t, r, "standard.yaml")
		if got := back.Stages[impl].Steps[0]; got.SmartScript != "Summarize" || !reflect.DeepEqual(got.Params, wf.Stages[impl].Steps[0].Params) {
			t.Fatalf("round trip: %+v", got)
		}
	})

	t.Run("kind change drops foreign keys", func(t *testing.T) {
		wf := load(t, r, "standard.yaml")
		for i := range wf.Stages {
			if wf.Stages[i].ID == "spec" {
				wf.Stages[i] = adewire.Stage{ID: "spec", Name: "Spec", Kind: "script", Status: "To do", Command: "make spec",
					RunsOn: "once", OnFailure: "stop", Timeout: "5m", Steps: []adewire.PipelineStep{}}
			}
		}
		out := saveOK(t, r, "standard.yaml", wf)
		_, seg, _ := strings.Cut(out, "id: spec")
		seg, _, _ = strings.Cut(seg, "- id:")
		if strings.Contains(seg, "session:") || strings.Contains(seg, "prompt:") || !strings.Contains(seg, "command: make spec") {
			t.Fatalf("spec stage:\n%s", seg)
		}
	})
}

func TestSave_refusals(t *testing.T) {
	r := newReader(t)
	if _, err := r.SaveYaml("w.yaml", "id: w\nname: [\n"); err != nil {
		t.Fatal(err)
	}
	wf := adewire.Workflow{ID: "w", Name: "W", Stages: []adewire.Stage{{ID: "u", Name: "U", Kind: "user", Status: "To do", Steps: []adewire.PipelineStep{}}}}
	before := read(t, r, "w.yaml")
	if _, err := r.Save("w.yaml", wf); err == nil || !strings.Contains(err.Error(), "fix the YAML error on line") {
		t.Fatalf("syntax error: %v", err)
	}
	if read(t, r, "w.yaml") != before {
		t.Fatal("file overwritten")
	}
	bad := wf
	bad.ID = "other"
	if _, err := r.Save("w.yaml", bad); err == nil {
		t.Fatal("id/stem mismatch accepted")
	}
	bad = wf
	bad.Stages = []adewire.Stage{{ID: "s", Name: "S", Kind: "script", Status: "To do", Steps: []adewire.PipelineStep{}}}
	if _, err := r.Save("fresh.yaml", bad); err == nil {
		t.Fatal("invalid workflow accepted")
	}
	if _, err := os.Stat(filepath.Join(r.Dir, "fresh.yaml")); !os.IsNotExist(err) {
		t.Fatal("invalid workflow written")
	}
	if _, err := r.SaveYaml("../x.yaml", "x"); err == nil {
		t.Fatal("path traversal accepted")
	}
}

func TestNewAndImport(t *testing.T) {
	r := newReader(t)
	if _, err := os.Stat(r.Dir); !os.IsNotExist(err) {
		t.Fatal("dir exists before first write")
	}
	e1, err := r.New("My Flow!")
	if err != nil || e1.FileName != "my-flow.yaml" || e1.Workflow == nil {
		t.Fatalf("new: %+v %v", e1, err)
	}
	e2, err := r.New("My Flow!")
	if err != nil || e2.FileName != "my-flow-2.yaml" || e2.Workflow.ID != "my-flow-2" {
		t.Fatalf("collision: %+v %v", e2, err)
	}
	src := filepath.Join(t.TempDir(), "Weird Name.yaml")
	if err := os.WriteFile(src, []byte("id: [\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e3, err := r.Import(src)
	if err != nil || e3.FileName != "weird-name.yaml" || e3.Error == nil {
		t.Fatalf("import unparseable: %+v %v", e3, err)
	}
	if _, err := r.Import(src); err == nil {
		t.Fatal("second import over existing accepted")
	}
	good, _ := os.ReadFile(filepath.Join(samplesDir, "chore.yaml"))
	src2 := filepath.Join(t.TempDir(), "anything.yaml")
	if err := os.WriteFile(src2, good, 0o644); err != nil {
		t.Fatal(err)
	}
	e4, err := r.Import(src2)
	if err != nil || e4.FileName != "chore.yaml" || e4.Workflow == nil {
		t.Fatalf("import valid: %+v %v", e4, err)
	}
}
