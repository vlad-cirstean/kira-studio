// P5 D18: the shared corpus, Go side. frontend/src/http/substitute.ts's own resolve() runs the
// identical cases (tests/unit/http-substitution.spec.ts) — a case added to testdata/
// substitution.json must pass on both sides or one of them fails.
package httpvars_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpvars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
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

// newResolveService opens a real (tmpfile-backed) SQLite database through the real migrations —
// mirrors repos_test's own newVariablesRepo (variables_test.go); duplicated rather than imported
// since that helper lives in an internal _test.go file of a different package. Auth is nil: none of
// ResolveRequest's own path ever calls it (only Reveal/RevealHistory do). The returned
// *repos.VariablesRepo is the exact instance the Service resolves secrets through — seeding via it
// directly (rather than a second, independent instance) is what makes SecretsFor see the row.
func newResolveService(t *testing.T) (*httpvars.Service, *repos.VariablesRepo, *repos.CollectionsRepo) {
	t.Helper()
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	variablesRepo := repos.NewVariables(db.DB, secrets.New())
	return httpvars.New(variablesRepo, secrets.New(), nil), variablesRepo, &repos.CollectionsRepo{DB: db.DB}
}

// P9 §6.2: ResolveRequest's fourth return is exactly the secret name→value pairs it actually
// substituted — the pair set P9 D6's masking replacer needs — and empty when the request
// references none.
func TestResolveRequestReturnsExactlyTheSecretsItSubstituted(t *testing.T) {
	svc, variablesRepo, collections := newResolveService(t)
	c, err := collections.CreateCollection("Orders")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}

	t.Run("substitutes and reports exactly what it used", func(t *testing.T) {
		if _, err := variablesRepo.Upsert(model.VariableScopeCollection, c.ID, "", "token", "sekret-value", true); err != nil {
			t.Fatalf("Upsert: %v", err)
		}

		url, headers, body, used, err := svc.ResolveRequest(
			"https://api.example.com/orders",
			[]httpclient.Header{{Name: "Authorization", Value: "Bearer {{token}}"}},
			httpclient.Body{Mode: "none"},
			c.ID, "",
		)
		if err != nil {
			t.Fatalf("ResolveRequest: %v", err)
		}
		if url != "https://api.example.com/orders" {
			t.Errorf("url = %q, unexpectedly changed", url)
		}
		if len(headers) != 1 || headers[0].Value != "Bearer sekret-value" {
			t.Fatalf("headers = %+v, want Authorization: Bearer sekret-value", headers)
		}
		if body.Mode != "none" {
			t.Errorf("body.Mode = %q, want none", body.Mode)
		}
		if len(used) != 1 || used["token"] != "sekret-value" {
			t.Fatalf("used = %+v, want {token: sekret-value}", used)
		}
	})

	t.Run("empty when the request references no secret", func(t *testing.T) {
		_, _, _, used, err := svc.ResolveRequest(
			"https://api.example.com/orders?x={{plain}}",
			nil, httpclient.Body{Mode: "none"}, c.ID, "",
		)
		if err != nil {
			t.Fatalf("ResolveRequest: %v", err)
		}
		if len(used) != 0 {
			t.Fatalf("used = %+v, want empty", used)
		}
	})
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
