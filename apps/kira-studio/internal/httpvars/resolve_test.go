// P5 D18: the shared corpus, Go side. frontend/src/http/substitute.ts's own resolve() runs the
// identical cases (tests/unit/http-substitution.spec.ts) — a case added to testdata/
// substitution.json must pass on both sides or one of them fails.
package httpvars_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpvars"
)

type corpusCase struct {
	Name     string            `json:"name"`
	Template string            `json:"template"`
	Values   map[string]string `json:"values"`
	Secrets  []string          `json:"secrets"`
	Want     string            `json:"want"`
	Refs     []struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"refs"`
}

func loadCorpus(t *testing.T) []corpusCase {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "substitution.json"))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	var cases []corpusCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("decode corpus: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("corpus is empty")
	}
	return cases
}

func TestResolveAgainstTheSharedCorpus(t *testing.T) {
	for _, c := range loadCorpus(t) {
		t.Run(c.Name, func(t *testing.T) {
			result := httpvars.Resolve(c.Template, c.Values, c.Secrets)
			if result.Text != c.Want {
				t.Errorf("Text = %q, want %q", result.Text, c.Want)
			}
			if len(result.Refs) != len(c.Refs) {
				t.Fatalf("Refs = %+v, want %+v", result.Refs, c.Refs)
			}
			for i, ref := range result.Refs {
				want := c.Refs[i]
				if string(ref.Name) != want.Name || string(ref.Kind) != want.Kind {
					t.Errorf("Refs[%d] = {%s %s}, want {%s %s}", i, ref.Name, ref.Kind, want.Name, want.Kind)
				}
			}
		})
	}
}

func TestNamesFindsEveryDistinctReferenceOnce(t *testing.T) {
	got := httpvars.Names("{{a}}/{{b}}?x={{a}}&y={{ c }}")
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("Names = %v, want %v", got, want)
	}
	for i, name := range want {
		if got[i] != name {
			t.Errorf("Names[%d] = %q, want %q", i, got[i], name)
		}
	}
}
