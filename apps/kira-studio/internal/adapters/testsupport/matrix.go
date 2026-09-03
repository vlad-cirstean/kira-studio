// matrix.go is P25 §3's harness for the complete (Tier 2) permutation suite — auth/config cases
// only in this phase; Scenario exists as the seam a later functional-testing phase populates,
// deliberately unused beyond a Then slice that stays empty here. Case/Outcome/RunMatrix live here,
// once, so a per-adapter authmatrix_test.go only ever declares its own table.
package testsupport

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const matrixEnv = "KIRA_TEST_MATRIX"

// FixturePassword is the shared default password every container fixture's baked-in principal
// uses (postgres.go, mariadb.go, mysql.go, mongo.go, clickhouse.go, redis.go, kafka_sasl.go) —
// exported so a per-adapter authmatrix_test.go that needs the real credential (rather than an
// intentionally-wrong one) references this instead of re-typing the literal, the exact drift this
// constant exists to prevent. Deliberately not "kira": that used to be the shared default, and
// "kira" is a substring of several fixture identifiers a driver can legitimately echo in error
// text — the database names kira_test/kira_analytics/kira_admin, kafka's own "kira-studio" client
// id and "kira-sasl-test-cluster" cluster id — so a passing case's incidental error text could
// satisfy this file's own password-leak assertion below by accident, on a message that never
// actually echoed the password. No case triggers that today (every failing case already overrides
// the password to something else distinctive), but the hazard is real for future additions
// (finding 7). A fixture's own password must never collide as a substring with any other fixture
// identifier.
const FixturePassword = "kira-fixture-pw"

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
			// P29 F6: the op log persists this exact error text to disk for
			// advanced.opLogRetentionDays — verify a failed connect never echoes the password
			// back, in either config shape. The failure message deliberately does not print the
			// error itself, so a real leak doesn't also land in CI logs.
			if p := cfg.Password; p != nil && *p != "" && strings.Contains(err.Error(), *p) {
				t.Error("Connect error text contains the connection password verbatim")
			}
			if p := passwordFromURI(cfg.URI); p != "" && strings.Contains(err.Error(), p) {
				t.Error("Connect error text contains the URI-embedded password verbatim")
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

// passwordFromURI extracts a uri-mode case's embedded password from its userinfo segment (a
// read-only sibling of internal/connections' own unexported stripURIPassword, kept local since
// that one isn't exported) — P29 F6's leak assertion needs it because a uri-mode Case carries the
// password inside cfg.URI rather than cfg.Password.
func passwordFromURI(uri *string) string {
	if uri == nil {
		return ""
	}
	idx := strings.Index(*uri, "://")
	if idx < 0 {
		return ""
	}
	authority := (*uri)[idx+3:]
	if i := strings.IndexAny(authority, "/?#"); i >= 0 {
		authority = authority[:i]
	}
	at := strings.LastIndex(authority, "@")
	if at < 0 {
		return ""
	}
	userinfo := authority[:at]
	colon := strings.IndexByte(userinfo, ':')
	if colon < 0 {
		return ""
	}
	return userinfo[colon+1:]
}

// RunScenarios applies the same Requires gate RunMatrix does, outside a matrix table (P26 §2.1) —
// the one addition this phase makes to the harness, so a scenario written once against a live
// (already-connected) adapter backs both the general (Tier-1, ungated) suite and the complete
// (Tier-2, KIRA_TEST_MATRIX-gated) one instead of being written twice. Unlike RunMatrix, this does
// not call RequireMatrix itself — a Tier-1 caller must run unconditionally, and a Tier-2 caller
// already ran it via RunMatrix/RequireMatrix before a is connected.
func RunScenarios(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig, scenarios ...Scenario) {
	t.Helper()
	for _, s := range scenarios {
		s := s
		if s.Requires != nil && !s.Requires(a.Caps()) {
			continue
		}
		t.Run(s.Name, func(t *testing.T) { s.Run(t, a, cfg) })
	}
}
