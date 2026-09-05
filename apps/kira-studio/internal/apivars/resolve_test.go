// P5 D18: the shared corpus, Go side. packages/api-core/src/http/substitute.ts's own resolve() runs the
// identical cases (tests/unit/http-substitution.spec.ts) — a case added to testdata/
// substitution.json must pass on both sides or one of them fails.
package apivars_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
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
		Name     string   `json:"name"`
		Kind     string   `json:"kind"`
		Pipeline []string `json:"pipeline"`
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
			result := apivars.Resolve(c.Template, c.Values, c.Secrets)
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
				// P17 D4: Pipeline is nil (omitted from the JSON) for every case that predates the
				// pipe grammar — normalize both sides to a same-length comparison so a corpus entry
				// with no "pipeline" key (unmarshalled as a nil slice) compares equal to Go's own nil.
				if len(ref.Pipeline) != len(want.Pipeline) {
					t.Errorf("Refs[%d].Pipeline = %v, want %v", i, ref.Pipeline, want.Pipeline)
					continue
				}
				for j, step := range ref.Pipeline {
					if step != want.Pipeline[j] {
						t.Errorf("Refs[%d].Pipeline[%d] = %q, want %q", i, j, step, want.Pipeline[j])
					}
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
func newResolveService(t *testing.T) (*apivars.Service, *repos.VariablesRepo, *repos.CollectionsRepo) {
	t.Helper()
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	variablesRepo := repos.NewVariables(db.DB, secrets.New())
	return apivars.New(variablesRepo, secrets.New(), nil), variablesRepo, &repos.CollectionsRepo{DB: db.DB}
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

	// Round-2 review finding 6: a reference that never resolves — a stale id, a typo, or a secret
	// whose decrypt failed — is left verbatim in the URL by design (D10). Resolver.Text/URLText
	// always call Resolve with secretNames nil (D9/F21's own extraction), so a name that turns out
	// not to be any of this scope's secrets falls into the exact same branch a decrypt failure
	// would — reproduced here with a plain unresolvable name, since the fixture already has a
	// space in it (a real Postman variable-name shape, substitute.ts's own doc). The raw space
	// used to reach net/http's own request line unescaped, which the *server* rejects with a 400
	// before ever reading a single header — driven through a real httpclient.Send against a real
	// httptest server, not just url.Parse (which tolerates the raw space and never errors, so it
	// alone would not have caught this).
	t.Run("finding 6: an unresolved reference with a space in its name doesn't break the request line", func(t *testing.T) {
		var gotRequestURI string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotRequestURI = r.RequestURI
			w.WriteHeader(http.StatusTeapot)
		}))
		defer srv.Close()

		resolvedURL, _, _, _, err := svc.ResolveRequest(
			srv.URL+"/orders?a={{base url}}&b=2",
			nil, httpclient.Body{Mode: "none"}, c.ID, "",
		)
		if err != nil {
			t.Fatalf("ResolveRequest: %v", err)
		}
		if strings.Contains(resolvedURL, "{{base url}}") {
			t.Fatalf("resolvedURL = %q still has a raw space inside the unresolved reference", resolvedURL)
		}
		if !strings.Contains(resolvedURL, "{{base%20url}}") {
			t.Fatalf("resolvedURL = %q, want the reference recognisable as {{base%%20url}}", resolvedURL)
		}

		resp, err := httpclient.Send(context.Background(), httpclient.Request{Method: "GET", URL: resolvedURL})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}
		// The server actually received and parsed a well-formed request line — "the reference
		// itself isn't found by the server" (it's an unresolved {{...}} token, not this app's
		// concern) shows up as *this handler's own* status, never a client-side 400 from a
		// malformed request line the server bounced before routing it anywhere.
		if resp.Status != http.StatusTeapot {
			t.Errorf("resp.Status = %d, want %d (the handler's own answer) — the request line reached the server intact", resp.Status, http.StatusTeapot)
		}
		if !strings.Contains(gotRequestURI, "b=2") {
			t.Errorf("server saw RequestURI = %q, lost the second, unrelated query param", gotRequestURI)
		}
	})
}

func TestNamesFindsEveryDistinctReferenceOnce(t *testing.T) {
	got := apivars.Names("{{a}}/{{b}}?x={{a}}&y={{ c }}")
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
