// matrix.go is P25 §3's harness for the complete (Tier 2) permutation suite — auth/config cases
// only in this phase; Scenario exists as the seam a later functional-testing phase populates,
// deliberately unused beyond a Then slice that stays empty here. Case/Outcome/RunMatrix live here,
// once, so a per-adapter authmatrix_test.go only ever declares its own table.
package testsupport

import (
	"context"
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const matrixEnv = "KIRA_TEST_MATRIX"

// RequireMatrix skips unless the complete suite was explicitly asked for. Call it before starting
// any fixture (StartX), not just before RunMatrix — an ordinary `go test ./...` must never pay for
// a container this tier alone needs.
func RequireMatrix(t *testing.T) {
	t.Helper()
	if os.Getenv(matrixEnv) != "1" {
		t.Skip("set " + matrixEnv + "=1 to run the permutation matrix (scripts/test-matrix.sh)")
	}
}

// Principal is one server-side identity a case needs, created inside the adapter's already-running
// shared container (P25 §2.3 — one container per adapter, roles created at runtime inside it) and
// torn down with the test that asked for it. f is the adapter's own fixture pointer (e.g.
// *RedisFixture) — untyped because each adapter's Setup closure is written against its own
// concrete fixture type; RunMatrix never inspects it, only passes it through.
type Principal struct {
	Name  string
	Setup func(t *testing.T, f any)
}

// Outcome is what Connect must produce. Exactly one of Succeed and a Code assertion is meaningful:
// when Succeed, FailWith/NotCode are ignored; when not, FailWith asserts the exact code and NotCode
// asserts the failure is anything *but* that code (P25 §2.4 row 6's "a permission refusal must not
// read as E_AUTH" shape, which recurs in nearly every adapter's own matrix).
type Outcome struct {
	Succeed  bool
	FailWith adapters.ErrorCode
	NotCode  adapters.ErrorCode
	Details  map[string]string // asserted as a subset of ConnectInfo.Details
}

// Case is one connection configuration plus the connect outcome it must produce, plus whatever
// Scenarios a later phase attaches once a connection of that shape comes up.
type Case struct {
	Name      string
	Principal *Principal // nil = the fixture's own base config needs no extra principal
	Config    func(base model.ResolvedConnectionConfig) model.ResolvedConnectionConfig
	Expect    Outcome
	Then      []Scenario // empty in P25 — the seam a functional-testing phase populates
}

// Scenario is one thing to do with a connection that came up — the extension point a later,
// functional-testing phase populates. P25 plants none; RunMatrix already drives Then correctly for
// whenever one exists.
type Scenario struct {
	Name     string
	Requires func(adapters.Caps) bool // skip where the adapter does not claim the capability
	Run      func(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig)
}

// RunMatrix drives every case as a subtest: RequireMatrix, Principal.Setup, build the config,
// Connect, assert Outcome, run each Scenario whose Requires passes, Disconnect. kind is the
// adapter's own registry name ("redis", "mongodb", ...); fixture is passed straight through to
// each case's own Principal.Setup, untouched.
func RunMatrix(t *testing.T, kind string, fixture any, base model.ResolvedConnectionConfig, cases []Case) {
	t.Helper()
	RequireMatrix(t)
	deps := adapters.Deps{Log: func(level, message string) {}}

	for _, c := range cases {
		c := c
		t.Run(c.Name, func(t *testing.T) {
			if c.Principal != nil {
				c.Principal.Setup(t, fixture)
			}
			cfg := base
			if c.Config != nil {
				cfg = c.Config(base)
			}

			a, err := adapters.CreateAdapter(kind, deps)
			if err != nil {
				t.Fatalf("CreateAdapter(%s): %v", kind, err)
			}

			info, err := a.Connect(context.Background(), cfg, adapters.NewOpCtx("matrix-"+kind))

			if c.Expect.Succeed {
				if err != nil {
					t.Fatalf("Connect: want success, got %v", err)
				}
				t.Cleanup(func() { _ = a.Disconnect(context.Background()) })
				for k, want := range c.Expect.Details {
					if got := info.Details[k]; got != want {
						t.Errorf("Details[%s] = %q, want %q", k, got, want)
					}
				}
				for _, s := range c.Then {
					if s.Requires != nil && !s.Requires(a.Caps()) {
						continue
					}
					t.Run(s.Name, func(t *testing.T) { s.Run(t, a, cfg) })
				}
				return
			}

			if err == nil {
				t.Fatal("Connect: want an error, got nil")
			}
			code, _ := adapters.CodeOf(err)
			if c.Expect.FailWith != "" && code != c.Expect.FailWith {
				t.Errorf("code = %v, want %v (err: %v)", code, c.Expect.FailWith, err)
			}
			if c.Expect.NotCode != "" && code == c.Expect.NotCode {
				t.Errorf("code = %v, must not be %v (err: %v)", code, c.Expect.NotCode, err)
			}
		})
	}
}
