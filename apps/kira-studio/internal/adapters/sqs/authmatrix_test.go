// authmatrix_test.go is the complete (Tier 2) suite's own table for sqs — P25 §2.8. Client-config
// permutations only, per §2.3's declined auth rows: LocalStack does not enforce credentials at any
// configuration this fixture can drive, verified directly (a bogus access key connects
// successfully even with ENFORCE_IAM=1), so there is no way to exercise a genuine SigV4 rejection
// or IAM permission boundary here. sqs and s3 share awscfg, so this table's shape mirrors s3's own
// (§2.8's rows 1-7) rather than a shared driver — per-adapter tables are the point (§3.1).
package sqs_test

import (
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// clearAwsEnv is a Principal that unsets AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_PROFILE for
// the duration of one subtest (t.Setenv-style auto-restore) — this sandbox's own outbound proxy
// injects placeholder AWS_* credentials (AGENTS.md), which would otherwise mask the "no
// credentials anywhere" case §1.5a's transcript needs.
var clearAwsEnv = &testsupport.Principal{
	Name: "clear ambient AWS env",
	Setup: func(t *testing.T, _ any) {
		t.Helper()
		for _, k := range []string{"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE"} {
			old, had := os.LookupEnv(k)
			_ = os.Unsetenv(k)
			t.Cleanup(func() {
				if had {
					_ = os.Setenv(k, old)
				}
			})
		}
	},
}

func TestSqs_AuthMatrix(t *testing.T) {
	testsupport.RequireMatrix(t)
	f := testsupport.StartSqs(t)

	testsupport.RunMatrix(t, "sqs", f, f.Config, []testsupport.Case{
		{
			Name:   "uri mode, key+secret in the URI host",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig { return c },
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "uri mode, key only, no secret",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.URI = testsupport.Strp("sqs://" + testsupport.LocalStackStaticAccessKey + "@" + testsupport.LocalStackRegion)
				return c
			},
			// config.go:45's both-or-nothing: a lone key never becomes a static credential, so this
			// connects via the ambient chain instead — pinned as known, not fixed by this phase.
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "uri mode, malformed URI",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.URI = testsupport.Strp("not a valid uri at all")
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			Name:      "fields mode, region only, no profile, no ambient credentials",
			Principal: clearAwsEnv,
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database = testsupport.Strp(testsupport.LocalStackRegion)
				c.Username, c.URI, c.Options = nil, nil, map[string]any{}
				return c
			},
			Expect: testsupport.Outcome{NotCode: adapters.CodeAuth},
		},
		{
			Name: "fields mode, profile that does not exist",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database = testsupport.Strp(testsupport.LocalStackRegion)
				c.Username = testsupport.Strp("p25-nonexistent-profile")
				c.URI, c.Options = nil, map[string]any{}
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeAuth},
		},
		{
			Name: "fields mode, region unset",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database, c.Username, c.URI = nil, nil, nil
				c.Options = map[string]any{}
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
	})

	// §2.8 row 7, declined: "options.endpoint absent" sends the request to real AWS, which this
	// sandbox's outbound network cannot reach unassisted (a bare TCP route to AWS's own endpoints,
	// not proxied). The plan leaves this row to the implementer's judgment when it depends on
	// outbound network; declined here, named explicitly rather than silently dropped.
	t.Run("uri mode, valid credentials, options.endpoint absent (declined: needs real AWS network access)", func(t *testing.T) {
		testsupport.RequireMatrix(t)
		t.Skip("declined: reaching real AWS with no endpoint override depends on outbound network this sandbox does not have")
	})
}
